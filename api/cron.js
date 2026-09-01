import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const OFFICIAL_SOURCES = [
  "https://gov.uz/oz/uzbmb"
];

async function getOfficialNews() {
  const results = [];

  for (const url of OFFICIAL_SOURCES) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "ALKHARAZMIY-NewsBot/1.0"
        }
      });

      if (!response.ok) continue;

      const html = await response.text();

      // Sahifadagi ko'rinadigan matnni soddalashtiramiz
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      results.push({
        source: url,
        content: text.slice(0, 15000)
      });

    } catch (error) {
      console.error("Source error:", url, error.message);
    }
  }

  return results;
}

async function generatePost(news) {
  const systemPrompt = `
Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

ALKHARAZMIY:
https://alkharazmiy.xyz

ALKHARAZMIY — turli fanlar bo'yicha Milliy Sertifikat imtihonlariga
tayyorgarlik ko'rish uchun online mock testlar va AI tahlil platformasi.

MUHIM:
ALKHARAZMIY faqat matematika platformasi emas.

Vazifang:
- foydali;
- qiziqarli;
- tabiiy;
- ishonchli;
- oldingi postlardan farqli

Telegram post yaratish.

KONTENT YO'NALISHLARI:

📚 Ta'limiy maslahatlar
🎯 Milliy Sertifikat
📰 Milliy Sertifikat yangiliklari
🧠 Quiz va testlar
🤖 AI va IT
🔥 Motivatsiya
🚀 ALKHARAZMIY haqida foydali ma'lumot

YANGILIK QOIDALARI:

Quyida berilgan ma'lumotlar rasmiy manbadan olingan.

Faqat shu ma'lumotlarga asoslan.

Hech qanday yangilikni o'ylab topma.

Sana, imtihon vaqti, fan, natija yoki boshqa faktlarni
berilgan manbada bo'lmasa yozma.

Eski ma'lumotni yangi yangilik sifatida ko'rsatma.

POST STRATEGIYASI:

Har bir postda faqat BITTA asosiy mavzuni yorit.

Hamma ma'lumotni birdaniga berma.

O'quvchini qiziqtir.

Postni haddan tashqari reklama qilma.

Agar ALKHARAZMIY haqida yozsang,
platformaning faqat bitta jihatini ko'rsat.

Platformada mavjud bo'lmagan funksiyani o'ylab topma.

Telegramdagi post hamma javobni berib qo'ymasligi kerak.
Batafsil ma'lumotga qiziqish uyg'ot.

USLUB:

- O'zbek tilida yoz.
- Tabiiy yoz.
- Qisqa paragraf ishlat.
- Emoji me'yorida bo'lsin.
- Clickbait ishlatma.
- Bir xil formatni takrorlama.
- Qiziqarli sarlavha yoz.

CTA:

Agar mavzu ALKHARAZMIY bilan bog'liq bo'lsa:

👉 Batafsil:
https://alkharazmiy.xyz

CTA'ni har safar bir xil ishlatmaslikka harakat qil.

Agar bu rasmiy yangilik bo'lsa,
yangilikning o'zini asosiy mavzu qil.
Keraksiz reklama qo'shma.

FAQAT POST MATNINI QAYTAR.
Hech qanday izoh, JSON yoki "mana post" yozma.
`;

  const userPrompt = `
Bugungi rasmiy manbalardan olingan ma'lumot:

${JSON.stringify(news)}

Shu ma'lumotlar asosida ALKHARAZMIY Telegram kanali uchun
eng qiziqarli va foydali BIRTA post yarat.

Agar rasmiy yangilik yetarli bo'lmasa,
yangilik o'ylab topma.

Bunday holatda ta'limiy, quiz, motivatsiya yoki
ALKHARAZMIY bilan bog'liq boshqa foydali post yarat.
`;

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    temperature: 0.8,
    max_tokens: 700
  });

  return completion.choices[0].message.content;
}

async function sendTelegram(post) {
  const url =
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHANNEL_ID,
      text: post,
      disable_web_page_preview: false
    })
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram error");
  }

  return data;
}

export default async function handler(req, res) {
  try {
    // Cron xavfsizligi
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

    // Rasmiy yangiliklarni olish
    const officialNews = await getOfficialNews();

    // AI post yaratish
    const post = await generatePost(officialNews);

    // Telegramga yuborish
    await sendTelegram(post);

    return res.status(200).json({
      success: true,
      message: "ALKHARAZMIY AI post yuborildi!",
      post
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
      }
