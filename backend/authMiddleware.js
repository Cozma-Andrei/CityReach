const { initFirebase } = require("./firebase");

async function verifyToken(req, res, next) {
  try {
    const admin = initFirebase();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token de autentificare lipsă" });
    }

    const token = authHeader.split("Bearer ")[1];

    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
      };
      next();
    } catch (error) {
      console.error("Token verification error:", error);
      return res.status(401).json({ error: "Token invalid sau expirat" });
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Eroare la verificarea autentificării" });
  }
}

module.exports = { verifyToken };
