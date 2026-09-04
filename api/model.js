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

    const models = await groq.models.list();

    const activeModels = models.data
      .filter(model => model.active)
      .map(model => ({
        id: model.id,
        owned_by: model.owned_by
      }));

    res.status(200).json({
      success: true,
      models: activeModels
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
