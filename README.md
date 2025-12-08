# CityReach

## Configurare mediu (.env)

### Backend (`backend/.env`)
Setează variabilele de mai jos într-un fișier `.env` în folderul `backend`:
```
PORT=5000
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=service-account@your-project.iam.gserviceaccount.com
# Folosește \\n pentru new line în cheie
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\nXXXX\\n-----END PRIVATE KEY-----\\n
# alternativ, poți folosi un fișier JSON:
# GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/serviceAccountKey.json
```

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:5000
```

## Rulare
```
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```