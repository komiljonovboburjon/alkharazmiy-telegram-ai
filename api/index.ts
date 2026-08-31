import express from "express";
import Groq from "groq-sdk";

const app = express();

app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

async function generatePost() {
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: `
Sen ALKHARAZMIY ta'lim platformasining Telegram kanal menejerisan.

O'zbek tilida yoz.
Postlar qisqa, qiziqarli va foydali bo'lsin.
Auditoriya: o'quvchilar, abituriyentlar va yoshlar.

Mavzular:
- ta'lim
- matematika
- milliy sertifikat
- AI
- IT
- imtihonga tayyorgarlik
- foydali maslahatlar
- motivatsiya

Postda keraksiz uzun kirish bo'lmasin.
Emoji me'yorida ishlat.
Clickbait va yolg'on ma'lumot ishlatma.

Oxirida ALKHARAZMIY platformasiga tabiiy CTA qo'sh.
        `
      },
      {
        role: "user",
        content: "Bugun kanal uchun yangi va takrorlanmagan foydali post yarat."
      }
    ],
    temperature: 0.8,
    max_tokens: 700
  });

  return completion.choices[0].message.content;
}

async function sendTelegramMessage(text) {
  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHANNEL_ID,
      text: text
    })
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram xatosi");
  }

  return data;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "ALKHARAZMIY Telegram AI"
  });
});

app.get("/api/post", async (req, res) => {
  try {
    const post = await generatePost();

    res.json({
      success: true,
      post
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/publish", async (req, res) => {
  try {
    const post = await generatePost();

    await sendTelegramMessage(post);

    res.json({
      success: true,
      message: "Post Telegram kanalga yuborildi.",
      post
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default app;
