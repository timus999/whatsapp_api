import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs"; 
import { Twilio, twiml as Twiml } from "twilio";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Twilio client
const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// JSON file to store incidents
const INCIDENTS_FILE = "./incidents.json";
// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Helper to keep Twilio messages < 1600 chars
function trimReply(text, limit = 1500) {
  if (!text) return "⚠️ No reply generated.";
  return text.length > limit
    ? text.slice(0, limit) + "\n\n[Message truncated]"
    : text;
}


// Load existing incidents or create empty array
function loadIncidents() {
  if (!fs.existsSync(INCIDENTS_FILE)) return [];
  const data = fs.readFileSync(INCIDENTS_FILE, "utf8");
  return JSON.parse(data);
}

// Save incidents to file
function saveIncidents(incidents) {
  fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(incidents, null, 2));
}

// Ask Gemini for a short legal answer
async function askGemini(question) {
  const result = await model.generateContent(
 `
You are a Nepali constitutional rights expert and emergency legal advisor. Your task is to respond to users in a clear, empathetic, and practical way. Follow these rules:

1. **Empathy first:** If the user seems to be in distress, provide calming, supportive guidance before any legal advice.
2. **Legal guidance:** Provide accurate and concise legal information relevant to Nepalese law.
3. **Specific questions:** If the user asks a specific question, answer precisely, and include citations from Nepalese law, official sources, or government guidelines if available.
4. **Practical advice:** Suggest actionable steps they can take (e.g., contact legal aid, police, or NGOs), including phone numbers if appropriate.
5. **Stay concise:** Keep answers under 120 words whenever possible.
6. **Do not give false reassurance:** Always indicate if they need professional help or direct them to verified resources.
7. **Media and emergencies:** If user reports incidents or emergencies, guide them to report authorities and NGOs safely.
8. **Tone:** Friendly, non-judgmental, and accessible to non-legal users.

Example user scenarios:

- User: "Police stopped me and asked me to sign something."  
  Response: "You have the right to remain silent. Do not sign anything without a lawyer. Contact Legal Aid Nepal at +977-98XXXXXXX. You can document the incident safely and report it later."

- User: "Can I protest without trouble?"  
  Response: "Nepalese law allows peaceful protests, but stay in designated areas, follow police instructions, and document any unlawful behavior. You may contact legal support if threatened."

Now respond to the following user question in a friendly, helpful, and legally accurate manner:
also try to answer clearly in less than 200 words.
${question}
`
  );
  return result.response.text();
}

// WhatsApp webhook
app.post("/", async (req, res) => {
  try {
    const from = req.body.From;
    const msg = req.body.Body?.trim() || "";

const mediaCount = parseInt(req.body.NumMedia || "0");
    let reply = "Type HELP to get emergency legal rights info.";

    if (!msg) return res.sendStatus(200);

    if (/help/i.test(msg)) {
      reply =
        "⚡ You have the right to remain silent. Don't sign any document without a lawyer. Ask me a specific question for more info.";
    } else if (/lawyer/i.test(msg)) {
      reply = "Nearest legal aid: +977-98XXXXXXX (Kathmandu).";
    } else if (/incident:/i.test(msg)) {
      // Handle INCIDENT report
      const description = msg.split(/incident:/i)[1]?.trim() || "No description";

      // Collect media URLs if any
      const media = [];
      for (let i = 0; i < mediaCount; i++) {
        const mediaUrl = req.body[`MediaUrl${i}`];
        const mediaType = req.body[`MediaContentType${i}`];
        if (mediaUrl) media.push({ url: mediaUrl, type: mediaType });
      }

      // Load existing incidents
      const incidents = loadIncidents();
      incidents.push({
        user_number: from,
        description,
        media,
        timestamp: new Date().toISOString(),
      });
      saveIncidents(incidents);

      reply = `✅ Your incident has been recorded with ${media.length} attachment(s). Stay safe!`;

      // Here you can trigger any **action based on the report**
      // e.g., send alert to admin, log for review, etc.
      console.log("New incident recorded:", { from, description, media });
    }else {
      // Gemini-powered Q&A
      reply = await askGemini(msg);
    }

    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: trimReply(reply),
    });

    res.writeHead(204);
    res.end();
  } catch (err) {
    console.error("Error:", err);
    res.sendStatus(500);
  }
}
 );



/* -----------------------
   SMS Webhook (/sms)
   ----------------------- */
app.post("/sms", (req, res) => {
  try {
    const userNumber = req.body.From;   // ✅ Sender’s phone number
    const userMessage = req.body.Body;  // ✅ Message text
    console.log(`SMS from ${userNumber}: ${userMessage}`);

    // Prepare a TwiML reply
    const response = new Twiml.MessagingResponse();
    response.message(`Hi! You said: ${userMessage}`);

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(response.toString());
  } catch (err) {
    console.error("SMS Error:", err);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT, () =>
  console.log(`🚀 Server running on port ${process.env.PORT}`)
);
