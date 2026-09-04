export default function handler(req, res) {
  res.status(200).json({
    success: true,
    name: "ALKHARAZMIY Telegram AI API",
    version: "1.0.0",
    website: "https://alkharazmiy.xyz",
    endpoints: {
      cron: "/api/cron",
      models: "/api/model",
      post: "/api/post",
      publish: "/api/publish",
      test: "/api/test"
    }
  });
}
