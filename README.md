<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/220daf3c-c8b7-49b6-aa77-e833d03ed155

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`
3. On first launch the app asks for a Gemini API key — get a free one at
   https://aistudio.google.com/apikey and paste it in. The key is stored only
   in your browser (localStorage).

   Alternatively, copy `.env.local.example` to `.env.local`, set
   `GEMINI_API_KEY` there, and restart the dev server.

**Note on models:** the app defaults to free-tier Gemini models (chat, TTS,
live voice, and image generation via `gemini-2.5-flash-image`). Video
generation (Veo) and Imagen portraits require an API key from a project with
billing enabled; the app falls back or explains this when they're unavailable.
