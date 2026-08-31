import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export default async function handler(req, res) {
  try {
    const auth = req.headers.authorization;

    if (
      process.env.CRON_SECRET &&
      auth !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `
Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

O'zbek tilida yoz.
Post qisqa, foydali va qiziqarli bo'lsin.

Mavzular:
- matematika
- ta'lim
- milliy sertifikat
- AI
- IT
- imtihonga tayyorgarlik
- motivatsiya

Emoji ishlat.
Telegram uchun chiroyli formatda yoz.
Oxirida ALKHARAZMIY platformasiga tabiiy CTA qo'sh.
          `
        },
        {
          role: "user",
          content: "Bugun kanal uchun yangi foydali post yarat."
        }
      ],
      temperature: 0.8,
      max_tokens: 600
    });

    const post = completion.choices[0].message.content;

    const telegramUrl =
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHANNEL_ID,
        text: post
      })
    });

    const telegramData = await telegramResponse.json();

    if (!telegramData.ok) {
      throw new Error(telegramData.description);
    }

    return res.status(200).json({
      success: true,
      message: "Avtomatik post Telegram kanalga yuborildi!"
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
        }
