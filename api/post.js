import Groq from "groq-sdk";

export default async function handler(req, res) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "GROQ_API_KEY environment variable is not configured."
      });
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `
Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

O'zbek tilida yoz.
Auditoriya: o'quvchilar, abituriyentlar va yoshlar.

Qiziqarli va foydali post yarat.
Mavzular:
- matematika
- ta'lim
- milliy sertifikat
- AI
- IT
- imtihonga tayyorgarlik
- motivatsiya

Post qisqa va tushunarli bo'lsin.
Emoji me'yorida ishlat.
Yolg'on yoki tasdiqlanmagan ma'lumot bermagin.

Oxirida ALKHARAZMIY platformasiga (https://alkharazmiy.xyz) tabiiy CTA qo'sh.
          `
        },
        {
          role: "user",
          content: "Bugun kanal uchun yangi post yarat."
        }
      ],
      temperature: 0.8,
      max_tokens: 600
    });

    const post = completion.choices[0].message.content;

    res.status(200).json({
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
}
