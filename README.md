# Study / Tickets — GitHub + Vercel ready

This version is deployment-ready for a GitHub-connected Vercel deployment.

## Deploy
1. Push this folder to a GitHub repository.
2. Import that repository into Vercel.
3. In Vercel: Project Settings → Environment Variables.
4. Add:
   - `AI_API_KEY` = your NEW secret API key
   - `AI_BASE_URL` = the exact OpenAI-compatible API base URL for your provider
   - `AI_MODEL` = your exact model ID
5. Redeploy.
6. Open the Vercel URL and test the AI box.

## Security
The API key is only read inside `api/chat.js` from `process.env.AI_API_KEY`.
It is never included in browser JavaScript.

## Important
GitHub Pages alone cannot securely run this private API backend. Use Vercel (or another serverless backend) connected to the GitHub repo.

## Image/PDF
The current UI includes image/PDF attachment controls. The basic chat route intentionally sends text only.
File/multimodal support should be enabled only after confirming that the selected provider/model supports the relevant input modality and endpoint.
