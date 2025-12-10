export function getFirebaseErrorMessage(error) {
  const errorCode = error?.code || error?.message || "";
  
  const errorMessages = {
    "auth/email-already-in-use": "Acest email este deja înregistrat. Te rugăm să te autentifici sau să folosești alt email.",
    "auth/invalid-email": "Adresa de email nu este validă.",
    "auth/operation-not-allowed": "Operația nu este permisă. Verifică setările Firebase Authentication.",
    "auth/weak-password": "Parola este prea slabă. Folosește o parolă mai puternică (minim 6 caractere).",
    "auth/user-disabled": "Acest cont a fost dezactivat. Contactează administratorul.",
    "auth/user-not-found": "Nu există un cont cu acest email.",
    "auth/wrong-password": "Parola este incorectă.",
    "auth/invalid-credential": "Email sau parolă incorectă.",
    "auth/too-many-requests": "Prea multe încercări eșuate. Te rugăm să aștepți înainte de a încerca din nou.",
    "auth/network-request-failed": "Eroare de rețea. Verifică conexiunea la internet.",
    "auth/configuration-not-found": "Configurația Firebase nu a fost găsită. Verifică fișierul .env.",
    "auth/invalid-api-key": "API key-ul Firebase nu este valid.",
    "auth/project-not-found": "Proiectul Firebase nu a fost găsit.",
  };

  for (const [code, message] of Object.entries(errorMessages)) {
    if (errorCode.includes(code)) {
      return message;
    }
  }

  if (error?.message) {
    return error.message;
  }

  return "A apărut o eroare. Te rugăm să încerci din nou.";
}
