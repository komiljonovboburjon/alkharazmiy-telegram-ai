import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export default async function handler(req, res) {
  try {
    // AI post yaratish
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `
Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

O'zbek tilida qisqa, foydali va qiziqarli post yoz.
Mavzular: ta'lim, matematika, AI, IT, imtihon,
milliy sertifikat va motivatsiya.

Emoji ishlat.
Postni Telegram formatida yoz.
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

    // Telegramga yuborish
    const telegramUrl =
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHANNEL_ID,
        text: post,
        parse_mode: "Markdown"
      })
    });

    const telegramData = await telegramResponse.json();

    if (!telegramData.ok) {
      throw new Error(telegramData.description);
    }

    res.status(200).json({
      success: true,
      message: "Post Telegram kanalga yuborildi!",
      post
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
          }
