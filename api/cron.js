import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const NEWS_PAGE = "https://gov.uz/oz/uzbmb";

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ALKHARAZMIY-AI/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Source ${response.status}: ${url}`);
  }

  return await response.text();
}

/*
  gov.uz yangiliklar sahifasidan maqola linklarini topadi.
*/
async function getNewsLinks() {
  const html = await fetchPage(NEWS_PAGE);

  const links = [];
  const regex = /href=["']([^"']*\/news\/view\/[^"']+)["']/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const url = new URL(match[1], NEWS_PAGE).href;

    if (!links.includes(url)) {
      links.push(url);
    }
  }

  return links.slice(0, 15);
}

/*
  Yangilikning O'Z sahifasidan:
  - title
  - sana
  - matn
  - asosiy rasm
  olinadi.
*/
async function getNewsArticle(url) {
  const html = await fetchPage(url);

  // Title
  let title = null;

  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );

  if (ogTitle) {
    title = ogTitle[1];
  }

  if (!title) {
    const titleTag = html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

    if (titleTag) {
      title = cleanText(titleTag[1]);
    }
  }

  // Asosiy rasm
  let image = null;

  const ogImage =
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    );

  if (ogImage) {
    image = new URL(ogImage[1], url).href;
  }

  // Sana
  let date = null;

  const dateMatch =
    html.match(
      /datetime=["']([^"']+)["']/i
    ) ||
    html.match(
      /202\d-\d\d-\d\d[^<]*/i
    );

  if (dateMatch) {
    date = dateMatch[1];
  }

  // Matn
  const text = cleanText(html);

  return {
    url,
    title,
    date,
    image,
    text: text.slice(0, 18000)
  };
}

/*
  Maqolalardan eng dolzarbini AI tanlaydi.
*/
async function chooseNews(articles) {
  const simplified = articles.map((article, index) => ({
    index,
    title: article.title,
    date: article.date,
    url: article.url
  }));

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: `
Sen ALKHARAZMIY Telegram kanalining yangilik tanlovchisisan.

Berilgan maqolalar FAQAT rasmiy Bilim va malakalarni
baholash agentligi manbasidan olingan.

Eng dolzarb va o'quvchilar uchun foydali BIRTA maqolani tanla.

Afzallik:
1. Yangi maqola
2. Milliy Sertifikatga aloqador
3. O'quvchilarga amaliy foydasi bor
4. Muhim rasmiy o'zgarish yoki e'lon

Eski yoki takroriy yangilikni tanlama.

Faqat JSON qaytar:
{"index": 0}

Boshqa hech narsa yozma.
`
      },
      {
        role: "user",
        content: JSON.stringify(simplified)
      }
    ],
    temperature: 0.2,
    max_tokens: 50
  });

  const answer = completion.choices[0].message.content;

  try {
    const parsed = JSON.parse(answer);
    return articles[parsed.index];
  } catch {
    return articles[0];
  }
}

/*
  Yangilik asosida Telegram posti.
*/
async function generatePost(article) {
  const systemPrompt = `
Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

ALKHARAZMIY:
https://alkharazmiy.xyz

ALKHARAZMIY — turli fanlar bo'yicha Milliy Sertifikat
imtihonlariga tayyorgarlik uchun online mock testlar
va AI tahlil platformasi.

MUHIM:
ALKHARAZMIY faqat matematika platformasi emas.

SENING VAZIFANG:
Rasmiy yangilikni Telegram uchun qiziqarli,
qisqa va foydali postga aylantirish.

QOIDALAR:

- Faqat berilgan rasmiy maqoladagi faktlardan foydalan.
- Hech qanday faktni o'ylab topma.
- Sana, raqam, imtihon yoki tartibni o'zgartirma.
- Maqolada yo'q ma'lumotni qo'shma.
- Yangilikni haddan tashqari uzun qilib yuborma.
- Bitta asosiy g'oyani ajratib ko'rsat.
- O'quvchiga hamma tafsilotni birdaniga berma.
- Qiziqish uyg'ot.
- Clickbait ishlatma.

USLUB:

- O'zbek tilida.
- Tabiiy.
- Zamonaviy.
- Telegramga mos.
- Qisqa paragraflar.
- Emoji me'yorida.

ALKHARAZMIY'ni faqat kerak bo'lsa tabiiy tarzda eslat.

Agar mos bo'lsa:
👉 Batafsil:
https://alkharazmiy.xyz

FAQAT POST MATNINI QAYTAR.
JSON qaytarma.
Izoh yozma.
`;

  const userPrompt = `
RASMIY MANBA:
${article.url}

SANA:
${article.date}

SARLAVHA:
${article.title}

MAQOLA:
${article.text}

Shu rasmiy maqolaga asoslanib ALKHARAZMIY
Telegram kanali uchun bitta qiziqarli post yoz.
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
    temperature: 0.75,
    max_tokens: 700
  });

  return completion.choices[0].message.content.trim();
}

/*
  Telegram:
  rasm bor bo'lsa -> sendPhoto
  rasm bo'lmasa -> sendMessage
*/
async function sendTelegram(post, image) {
  const base =
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

  if (image) {
    const response = await fetch(`${base}/sendPhoto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHANNEL_ID,
        photo: image,
        caption: post
      })
    });

    const data = await response.json();

    if (!data.ok) {
      console.error("sendPhoto failed:", data);

      // Rasm ishlamasa, matnni oddiy post qilamiz
      const fallback = await fetch(`${base}/sendMessage`, {
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

      const fallbackData = await fallback.json();

      if (!fallbackData.ok) {
        throw new Error(
          fallbackData.description || "Telegram error"
        );
      }

      return fallbackData;
    }

    return data;
  }

  const response = await fetch(`${base}/sendMessage`, {
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
    // Cron himoyasi
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

    // 1. Rasmiy maqolalar linklarini olish
    const links = await getNewsLinks();

    if (!links.length) {
      throw new Error(
        "Rasmiy yangiliklar topilmadi"
      );
    }

    // 2. Har bir maqoladan ma'lumot olish
    const articles = [];

    for (const link of links.slice(0, 8)) {
      try {
        const article = await getNewsArticle(link);

        if (article.title && article.text) {
          articles.push(article);
        }
      } catch (error) {
        console.error(
          "Article error:",
          link,
          error.message
        );
      }
    }

    if (!articles.length) {
      throw new Error(
        "Maqolalar o'qilmadi"
      );
    }

    // 3. Eng yaxshi yangilikni tanlash
    const selected = await chooseNews(articles);

    // 4. AI post yaratish
    const post = await generatePost(selected);

    // 5. Aynan tanlangan maqolaning rasmi
    const image = selected.image || null;

    // 6. Telegramga yuborish
    await sendTelegram(post, image);

    return res.status(200).json({
      success: true,
      message: "Rasmiy yangilik + rasm Telegramga yuborildi!",
      source: selected.url,
      title: selected.title,
      image,
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
