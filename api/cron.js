import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const SOURCES = [
  "https://gov.uz/oz/uzbmb"
];

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

/* =========================
   HTML TO TEXT
========================= */

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

/* =========================
   FETCH
========================= */

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

/* =========================
   EXTRACT GOV.UZ NEWS LINKS
========================= */

function extractNewsLinks(html) {
  const links = new Set();

  /*
    1. Oddiy href
  */
  const hrefRegex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const value = match[1];

    if (
      value.includes("/oz/uzbmb/news/view/") ||
      value.includes("/uz/uzbmb/news/view/")
    ) {
      try {
        const url = new URL(
          value,
          "https://gov.uz"
        ).href;

        links.add(url);
      } catch {}
    }
  }

  /*
    2. To'liq URL
  */
  const fullRegex =
    /https?:\/\/gov\.uz\/(?:oz|uz)\/uzbmb\/news\/view\/\d+/gi;

  while ((match = fullRegex.exec(html)) !== null) {
    links.add(match[0]);
  }

  /*
    3. JSON ichidagi escaped URL
  */
  const escapedRegex =
    /(?:https?:\\\/\\\/gov\.uz|\/oz)\\?\/(?:oz\/)?uzbmb\\?\/news\\?\/view\\?\/\d+/gi;

  while ((match = escapedRegex.exec(html)) !== null) {
    let value = match[0]
      .replace(/\\\//g, "/");

    if (value.startsWith("/")) {
      value =
        "https://gov.uz" + value;
    }

    links.add(value);
  }

  return [...links];
}

/* =========================
   GET NEWS LINKS
========================= */

async function getNewsLinks() {
  const allLinks = new Set();

  for (const source of SOURCES) {
    try {
      const html = await fetchPage(source);

      const links =
        extractNewsLinks(html);

      console.log(
        `Found ${links.length} links from ${source}`
      );

      for (const link of links) {
        allLinks.add(link);
      }

    } catch (error) {
      console.error(
        "Source error:",
        error.message
      );
    }
  }

  /*
    Agar bosh sahifadan topilmasa,
    oldindan ma'lum bo'lgan gov.uz
    news endpointlarini tekshiramiz.
  */

  if (!allLinks.size) {
    console.log(
      "Main page links not found."
    );

    /*
      gov.uz sahifalarining pagination
      variantlarini tekshirish.
    */

    const possiblePages = [
      "https://gov.uz/oz/uzbmb/news",
      "https://gov.uz/oz/uzbmb/news?page=1",
      "https://gov.uz/oz/uzbmb/news?page=2",
      "https://gov.uz/oz/uzbmb/news?page=3"
    ];

    for (const page of possiblePages) {
      try {
        const html =
          await fetchPage(page);

        const links =
          extractNewsLinks(html);

        for (const link of links) {
          allLinks.add(link);
        }

      } catch (error) {
        console.error(
          "Pagination error:",
          error.message
        );
      }
    }
  }

  return [...allLinks].slice(0, 30);
}

/* =========================
   ARTICLE
========================= */

async function getNewsArticle(url) {
  const html = await fetchPage(url);

  /* TITLE */

  let title = null;

  const titlePatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,

    /<h1[^>]*>([\s\S]*?)<\/h1>/i,

    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const pattern of titlePatterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      title =
        cleanText(match[1]);

      if (title) break;
    }
  }

  /* IMAGE */

  let image = null;

  const imagePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,

    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];

  for (const pattern of imagePatterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      try {
        image =
          new URL(
            match[1],
            url
          ).href;

        break;
      } catch {}
    }
  }

  /* DATE */

  let date = null;

  const datePatterns = [
    /datetime=["']([^"']+)["']/i,

    /(2026-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i,

    /(2026-\d{2}-\d{2})/i
  ];

  for (const pattern of datePatterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      date = match[1];
      break;
    }
  }

  /* TEXT */

  const text =
    cleanText(html);

  return {
    url,
    title,
    date,
    image,
    text: text.slice(0, 20000)
  };
}

/* =========================
   SUPABASE
========================= */

async function supabaseRequest(
  endpoint,
  options = {}
) {
  const response =
    await fetch(
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

/* =========================
   CHECK DUPLICATE
========================= */

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

/* =========================
   SAVE POST
========================= */

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

/* =========================
   GET NEW ARTICLES
========================= */

async function getNewArticles() {
  const links =
    await getNewsLinks();

  console.log(
    "TOTAL LINKS:",
    links.length
  );

  const articles = [];

  for (
    const link of links.slice(0, 15)
  ) {
    try {
      const posted =
        await isPosted(link);

      if (posted) {
        console.log(
          "Already posted:",
          link
        );

        continue;
      }

      const article =
        await getNewsArticle(link);

      if (
        article.title &&
        article.text
      ) {
        articles.push(article);

        console.log(
          "NEW ARTICLE:",
          article.title
        );
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

/* =========================
   AI SELECT NEWS
========================= */

async function chooseNews(
  articles
) {
  const simplified =
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
gov.uz manbasidan olingan.

Eng foydali BITTA yangilikni tanla.

Ustuvorlik:

1. Eng yangi yangilik
2. Milliy Sertifikat
3. Abituriyentlar uchun foydali
4. Muhim rasmiy o'zgarish
5. Imtihon sanasi yoki tartibi
6. Natijalar
7. Ruxsatnoma
8. Ro'yxatdan o'tish

Faqat:

{"index": 0}

formatida javob ber.
`
        },

        {
          role: "user",

          content:
            JSON.stringify(
              simplified
            )
        }
      ],

      temperature: 0.1,

      max_tokens: 50
    });

  try {
    const parsed =
      JSON.parse(
        completion
          .choices[0]
          .message
          .content
          .trim()
      );

    if (
      Number.isInteger(
        parsed.index
      ) &&
      articles[parsed.index]
    ) {
      return articles[
        parsed.index
      ];
    }

  } catch {}

  return articles[0];
}

/* =========================
   GENERATE TELEGRAM POST
========================= */

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
https://alkharazmiy.xyz

ALKHARAZMIY — turli fanlar bo'yicha
Milliy Sertifikat imtihonlariga
tayyorgarlik platformasi.

Bu faqat matematika platformasi emas.

POST QOIDALARI:

- Faqat rasmiy maqoladagi faktlardan foydalan.
- Fakt o'ylab topma.
- Sana va raqamlarni o'zgartirma.
- Hamma ma'lumotni birdaniga berma.
- Qiziqish uyg'ot.
- Bitta asosiy mavzuni tanla.
- Qisqa va tabiiy yoz.
- O'zbek tilida yoz.
- Telegram formatida yoz.
- Emoji me'yorida.
- Clickbait ishlatma.

Eng muhim ma'lumotni boshida ber.

Oxirida o'quvchini
ALKHARAZMIY saytiga tabiiy ravishda
yo'naltirish mumkin:

https://alkharazmiy.xyz

Lekin har bir postda platformaning
barcha imkoniyatlarini sanab o'tma.

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

Shu rasmiy maqolaga asoslanib
ALKHARAZMIY Telegram kanali uchun
qiziqarli post yoz.
`
        }
      ],

      temperature:
        0.75,

      max_tokens:
        700
    });

  return completion
    .choices[0]
    .message
    .content
    .trim();
}

/* =========================
   TELEGRAM
========================= */

async function sendTelegram(
  post,
  image
) {
  const base =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  /*
    RASM + POST
  */

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

    const data =
      await response.json();

    if (data.ok) {
      return data;
    }

    console.error(
      "sendPhoto error:",
      data
    );
  }

  /*
    Agar rasm ishlamasa,
    post baribir yuboriladi.
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

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "Telegram error"
    );
  }

  return data;
}

/* =========================
   MAIN
========================= */

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

        error:
          "Unauthorized"
      });
    }

    /*
      1. NEW ARTICLES
    */

    const articles =
      await getNewArticles();

    /*
      2. NOTHING NEW
    */

    if (!articles.length) {
      return res.status(200).json({
        success: true,

        message:
          "Yangi rasmiy yangilik topilmadi. Post yuborilmadi.",

        checked:
          true
      });
    }

    /*
      3. SELECT
    */

    const selected =
      await chooseNews(
        articles
      );

    /*
      4. AI POST
    */

    const post =
      await generatePost(
        selected
      );

    /*
      5. TELEGRAM
    */

    await sendTelegram(
      post,
      selected.image
    );

    /*
      6. SUPABASE
    */

    await savePost(
      selected
    );

    /*
      7. RESULT
    */

    return res.status(200).json({
      success: true,

      message:
        "Rasmiy yangilik + rasm Telegramga yuborildi!",

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
        error.message
    });
  }
}
