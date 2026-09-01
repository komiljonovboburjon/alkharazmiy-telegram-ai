import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

const GOV_SEARCH_URL =
  "https://gov.uz/oz/uzbmb";

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  return await response.text();
}

/*
  GOV.UZ sahifasidan news/view ID larni
  barcha mumkin bo'lgan ko'rinishlarda qidiradi.
*/
function extractNewsIds(html) {
  const ids = new Set();

  const patterns = [
    /\/news\/view\/(\d+)/gi,
    /news\\\/view\\\/(\d+)/gi,
    /news%2Fview%2F(\d+)/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) !== null) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

/*
  Rasmiy UZBMB sahifasini tekshiradi.
*/
async function getNewsLinks() {
  const html = await fetchPage(
    GOV_SEARCH_URL
  );

  const ids = extractNewsIds(html);

  console.log(
    "Found IDs:",
    ids
  );

  return ids.map(
    (id) =>
      `https://gov.uz/oz/uzbmb/news/view/${id}`
  );
}

/*
  Maqolani o'qish.
*/
async function getArticle(url) {
  const html = await fetchPage(url);

  let title = null;

  const titlePatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      title = cleanText(match[1]);

      if (title) {
        break;
      }
    }
  }

  let image = null;

  const imagePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];

  for (const pattern of imagePatterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      try {
        image = new URL(
          match[1],
          url
        ).href;

        break;
      } catch {
        image = null;
      }
    }
  }

  let date = null;

  const datePatterns = [
    /datetime=["']([^"']+)["']/i,
    /(2026-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i,
    /(2026-\d{2}-\d{2})/i
  ];

  for (const pattern of datePatterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
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
  SUPABASE so'rov.
*/
async function supabaseRequest(
  endpoint,
  options = {}
) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${endpoint}`,
    {
      ...options,

      headers: {
        apikey: SUPABASE_KEY,
        Authorization:
          `Bearer ${SUPABASE_KEY}`,
        "Content-Type":
          "application/json",
        ...(options.headers || {})
      }
    }
  );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `Supabase ${response.status}: ${body}`
    );
  }

  return response;
}

/*
  Yangilik avval yuborilganmi?
*/
async function isPosted(url) {
  const encoded =
    encodeURIComponent(url);

  const response =
    await supabaseRequest(
      `telegram_posts?source_url=eq.${encoded}&select=id`
    );

  const data =
    await response.json();

  return data.length > 0;
}

/*
  Supabase'ga saqlash.
*/
async function savePost(article) {
  await supabaseRequest(
    "telegram_posts",
    {
      method: "POST",

      headers: {
        Prefer:
          "resolution=ignore-duplicates"
      },

      body: JSON.stringify({
        source_url:
          article.url,

        title:
          article.title,

        image_url:
          article.image
      })
    }
  );
}

/*
  Rasmiy maqolalarni yig'ish.
*/
async function getArticles() {
  const links =
    await getNewsLinks();

  console.log(
    "TOTAL NEWS LINKS:",
    links.length
  );

  const articles = [];

  for (
    const link of links.slice(0, 10)
  ) {
    try {
      if (
        await isPosted(link)
      ) {
        console.log(
          "Already posted:",
          link
        );

        continue;
      }

      const article =
        await getArticle(link);

      if (
        article.title &&
        article.text
      ) {
        articles.push(article);

        console.log(
          "NEW:",
          article.title
        );
      }
    } catch (error) {
      console.error(
        "ARTICLE ERROR:",
        link,
        error.message
      );
    }
  }

  return articles;
}

/*
  AI yangilik tanlaydi.
*/
async function chooseNews(
  articles
) {
  const data =
    articles.map(
      (article, index) => ({
        index,
        title:
          article.title,
        date:
          article.date,
        url:
          article.url
      })
    );

  const completion =
    await groq.chat.completions.create({
      model:
        "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",

          content: `
Sen ALKHARAZMIY Telegram kanalining
yangilik tanlovchisisan.

Barcha maqolalar rasmiy
Bilim va malakalarni baholash
agentligi manbasidan olingan.

BITTA eng foydali yangilikni tanla.

Ustuvorlik:

1. Eng yangi
2. Milliy Sertifikat
3. Imtihon sanasi
4. Ro'yxatdan o'tish
5. Ruxsatnoma
6. Natijalar
7. Muhim rasmiy o'zgarish

Faqat JSON qaytar:

{"index":0}

Boshqa hech narsa yozma.
`
        },
        {
          role: "user",
          content:
            JSON.stringify(data)
        }
      ],

      temperature: 0.1,
      max_tokens: 50
    });

  try {
    const result =
      JSON.parse(
        completion
          .choices[0]
          .message
          .content
          .trim()
      );

    if (
      Number.isInteger(result.index) &&
      articles[result.index]
    ) {
      return articles[result.index];
    }
  } catch (error) {
    console.error(
      "AI SELECT ERROR:",
      error.message
    );
  }

  return articles[0];
}

/*
  Telegram posti yaratish.
*/
async function generatePost(
  article
) {
  const completion =
    await groq.chat.completions.create({
      model:
        "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",

          content: `
Sen ALKHARAZMIY Telegram kanalining
AI kontent menejerisan.

ALKHARAZMIY:
${ALKHARAZMIY_URL}

ALKHARAZMIY — turli fanlar bo'yicha
Milliy Sertifikat imtihonlariga
tayyorlanish platformasi.

Bu faqat matematika platformasi emas.

POST QOIDALARI:

- Faqat rasmiy maqoladagi faktlardan foydalan.
- Fakt o'ylab topma.
- Sana va raqamlarni o'zgartirma.
- Hamma ma'lumotni birdaniga berma.
- Qiziqish uyg'ot.
- O'quvchiga foydali asosiy ma'lumotni ber.
- Juda uzun yozma.
- O'zbek tilida yoz.
- Tabiiy Telegram uslubida yoz.
- Emoji me'yorida ishlat.
- Clickbait ishlatma.
- Har safar bir xil boshlama.
- Har postda boshqa jihatni yoritishga harakat qil.
- ALKHARAZMIY saytiga tabiiy ravishda qiziqtir.

Sayt:
${ALKHARAZMIY_URL}

FAQAT POST MATNINI QAYTAR.
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

Shu rasmiy maqola asosida
ALKHARAZMIY Telegram kanali uchun
bitta qiziqarli post yoz.
`
        }
      ],

      temperature: 0.75,
      max_tokens: 700
    });

  return completion
    .choices[0]
    .message
    .content
    .trim();
}

/*
  Telegramga rasm bilan yuborish.
*/
async function sendTelegram(
  post,
  image
) {
  const base =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  if (image) {
    const response =
      await fetch(
        `${base}/sendPhoto`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            chat_id:
              CHANNEL_ID,

            photo:
              image,

            caption:
              post
          })
        }
      );

    const result =
      await response.json();

    if (result.ok) {
      return result;
    }

    console.error(
      "sendPhoto failed:",
      result
    );
  }

  /*
    Rasm ishlamasa, matnni
    baribir yuboramiz.
  */

  const response =
    await fetch(
      `${base}/sendMessage`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          chat_id:
            CHANNEL_ID,

          text:
            post,

          disable_web_page_preview:
            false
        })
      }
    );

  const result =
    await response.json();

  if (!result.ok) {
    throw new Error(
      result.description ||
      "Telegram error"
    );
  }

  return result;
}

/*
  MAIN
*/
export default async function handler(
  req,
  res
) {
  try {
    /*
      CRON SECURITY
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

    console.log(
      "ALKHARAZMIY CRON STARTED"
    );

    /*
      1. Yangiliklarni olish
    */
    const articles =
      await getArticles();

    /*
      2. Yangi yangilik yo'q
    */
    if (!articles.length) {
      return res.status(200).json({
        success: true,

        message:
          "Yangi rasmiy yangilik topilmadi. Post yuborilmadi.",

        checked: true
      });
    }

    /*
      3. Eng yaxshi yangilik
    */
    const selected =
      await chooseNews(
        articles
      );

    /*
      4. Post
    */
    const post =
      await generatePost(
        selected
      );

    /*
      5. Telegram
    */
    await sendTelegram(
      post,
      selected.image
    );

    /*
      6. Supabase
    */
    await savePost(
      selected
    );

    return res.status(200).json({
      success: true,

      message:
        "Rasmiy yangilik Telegramga yuborildi!",

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
    console.error(
      "CRON ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error.message,

      type:
        error.name
    });
  }
}
