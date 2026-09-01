import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const NEWS_PAGE = "https://gov.uz/uz/uzbmb/news/view/208834";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
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
  gov.uz NEWS PAGE'dan maqola linklarini topish.
*/
async function getNewsLinks() {
  const html = await fetchPage(NEWS_PAGE);

  const links = [];

  const regex =
    /(?:href|url)\s*[:=]\s*["']([^"']*\/(?:oz|uz)\/uzbmb\/news\/view\/\d+)["']/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], NEWS_PAGE).href;

      if (
        url.includes("/uzbmb/news/view/") &&
        !links.includes(url)
      ) {
        links.push(url);
      }
    } catch {}
  }

  /*
    Agar HTML ichidan topilmasa, qidiruv sahifasidagi
    ko'rinadigan URL formatlarini boshqa regex bilan tekshiramiz.
  */
  if (!links.length) {
    const fallbackRegex =
      /https?:\/\/gov\.uz\/(?:oz|uz)\/uzbmb\/news\/view\/\d+/gi;

    let fallback;

    while ((fallback = fallbackRegex.exec(html)) !== null) {
      if (!links.includes(fallback[0])) {
        links.push(fallback[0]);
      }
    }
  }

  return [...new Set(links)].slice(0, 20);
}

/*
  Maqolaning o'zidan:
  title
  date
  image
  text
*/
async function getNewsArticle(url) {
  const html = await fetchPage(url);

  let title = null;

  const titleMatches = [
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    ),
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
    ),
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )
  ];

  for (const match of titleMatches) {
    if (match?.[1]) {
      title = cleanText(match[1]);
      break;
    }
  }

  let image = null;

  const imageMatches = [
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    ),
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    ),
    html.match(
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    )
  ];

  for (const match of imageMatches) {
    if (match?.[1]) {
      try {
        image = new URL(match[1], url).href;
        break;
      } catch {}
    }
  }

  let date = null;

  const dateMatches = [
    html.match(
      /datetime=["'](202\d-\d\d-\d\d[^"']*)["']/i
    ),
    html.match(
      /(202\d-\d\d-\d\d\s+\d\d:\d\d:\d\d)/
    )
  ];

  for (const match of dateMatches) {
    if (match?.[1]) {
      date = match[1];
      break;
    }
  }

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
  Supabase'da bu yangilik oldin yuborilganmi?
*/
async function isPosted(url) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_posts?source_url=eq.${encodeURIComponent(url)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase check error: ${response.status}`
    );
  }

  const data = await response.json();

  return data.length > 0;
}

/*
  Yuborilgan maqolani Supabase'ga saqlash.
*/
async function savePostedArticle(article) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_posts`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates"
      },
      body: JSON.stringify({
        source_url: article.url,
        title: article.title,
        image_url: article.image
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase save error: ${response.status} ${await response.text()}`
    );
  }
}

/*
  Yangi maqolalardan yuborilmaganlarini ajratish.
*/
async function getNewArticles() {
  const links = await getNewsLinks();

  console.log("Found links:", links.length);

  const articles = [];

  for (const link of links.slice(0, 12)) {
    try {
      const alreadyPosted = await isPosted(link);

      if (alreadyPosted) {
        console.log("Already posted:", link);
        continue;
      }

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

  return articles;
}

/*
  AI eng yaxshi yangilikni tanlaydi.
*/
async function chooseNews(articles) {
  const simplified = articles.map((article, index) => ({
    index,
    title: article.title,
    date: article.date,
    url: article.url
  }));

  const completion =
    await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",
          content: `
Sen ALKHARAZMIY Telegram kanalining
yangilik tanlovchisisan.

Berilgan maqolalarning barchasi
Bilim va malakalarni baholash agentligining
rasmiy gov.uz manbasidan olingan.

Eng foydali BIRTA maqolani tanla.

Ustuvorlik:

1. Eng yangi
2. Milliy Sertifikat bilan bog'liq
3. Abituriyentlar uchun muhim
4. Amaliy foydasi bor
5. Muhim rasmiy o'zgarish yoki e'lon

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

      temperature: 0.1,
      max_tokens: 50
    });

  const answer =
    completion.choices[0].message.content.trim();

  try {
    const parsed = JSON.parse(answer);

    if (
      typeof parsed.index === "number" &&
      articles[parsed.index]
    ) {
      return articles[parsed.index];
    }
  } catch {}

  return articles[0];
}

/*
  Telegram post yaratish.
*/
async function generatePost(article) {
  const completion =
    await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",
          content: `
Sen ALKHARAZMIY Telegram kanalining
AI kontent menejerisan.

ALKHARAZMIY:
https://alkharazmiy.xyz

ALKHARAZMIY turli fanlar bo'yicha
Milliy Sertifikat imtihonlariga tayyorgarlik
uchun online mock test va AI tahlil
platformasidir.

Muhim:
ALKHARAZMIY faqat matematika platformasi emas.

Vazifang:
Rasmiy yangilikni Telegram uchun
qiziqarli va foydali postga aylantirish.

QOIDALAR:

- Faqat berilgan maqoladagi faktlardan foydalan.
- Hech narsa o'ylab topma.
- Sana va raqamlarni o'zgartirma.
- Maqolada yo'q ma'lumotni qo'shma.
- Juda uzun yozma.
- Bitta asosiy mavzuni yorit.
- Hamma tafsilotni birdaniga berma.
- O'quvchida qiziqish uyg'ot.
- Clickbait ishlatma.
- Tabiiy o'zbek tilida yoz.
- Telegram uchun qisqa paragraflardan foydalan.
- Emoji me'yorida bo'lsin.

ALKHARAZMIY'ni faqat tabiiy joyda eslat.

Agar mos bo'lsa:

👉 Batafsil:
https://alkharazmiy.xyz

FAQAT POST MATNINI QAYTAR.
JSON yoki izoh qaytarma.
`
        },
        {
          role: "user",
          content: `
RASMIY MANBA:
${article.url}

SANA:
${article.date}

SARLAVHA:
${article.title}

MAQOLA:
${article.text}

Shu maqolaga asoslanib
ALKHARAZMIY Telegram kanali uchun
bitta qiziqarli post yoz.
`
        }
      ],

      temperature: 0.75,
      max_tokens: 700
    });

  return completion.choices[0]
    .message
    .content
    .trim();
}

/*
  Telegramga yuborish.
*/
async function sendTelegram(post, image) {
  const base =
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

  if (image) {
    const response =
      await fetch(`${base}/sendPhoto`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          chat_id:
            process.env.TELEGRAM_CHANNEL_ID,

          photo: image,

          caption: post
        })
      });

    const data = await response.json();

    if (data.ok) {
      return data;
    }

    console.error(
      "Photo send failed:",
      data.description
    );
  }

  /*
    Rasm ishlamasa post yo'qolib ketmasin.
  */
  const response =
    await fetch(`${base}/sendMessage`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        chat_id:
          process.env.TELEGRAM_CHANNEL_ID,

        text: post,

        disable_web_page_preview: false
      })
    });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram error"
    );
  }

  return data;
}

export default async function handler(req, res) {
  try {

    /*
      Cron himoyasi
    */
    const auth =
      req.headers.authorization;

    if (
      process.env.CRON_SECRET &&
      auth !==
        `Bearer ${process.env.CRON_SECRET}`
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    /*
      1. Yangi maqolalarni topamiz
    */
    const articles =
      await getNewArticles();

    /*
      Agar yangi maqola bo'lmasa,
      post yaratmaymiz.
    */
    if (!articles.length) {
      return res.status(200).json({
        success: true,
        message:
          "Yangi rasmiy yangilik topilmadi. Post yuborilmadi."
      });
    }

    /*
      2. Eng yaxshi yangilik
    */
    const selected =
      await chooseNews(articles);

    /*
      3. AI post
    */
    const post =
      await generatePost(selected);

    /*
      4. Telegram
    */
    await sendTelegram(
      post,
      selected.image
    );

    /*
      5. Supabase'ga saqlash
    */
    await savePostedArticle(selected);

    return res.status(200).json({
      success: true,

      message:
        "Yangi rasmiy yangilik + rasm Telegramga yuborildi.",

      source:
        selected.url,

      title:
        selected.title,

      date:
        selected.date,

      image:
        selected.image,

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
