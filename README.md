# Elarium Tierlist MVP

## Local run

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:3005`

## Admin password

Default admin password:
`0zqCqlJuMmZW67OJ`

You can override it with:
`ADMIN_PASSWORD=...`

## GitHub Pages

Frontend is deployed by workflow `.github/workflows/deploy-pages.yml`.

Set repository variable:
- `VITE_API_URL` -> public backend URL (for example your hosted Express server)

Without `VITE_API_URL`, frontend falls back to `http://localhost:3005`.
