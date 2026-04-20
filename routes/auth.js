import express from "express";
import { auth, db } from "../firebase-admin.js";

const router = express.Router();

/**
 * 📌 POST /api/auth/register
 * Recebe idToken, email, nome e uid do front (já criado via Firebase Client SDK)
 * Verifica o token no Firebase Admin e salva dados adicionais no Firestore
 * e cria uma sessão no Express.
 */
router.post("/register", async (req, res) => {
  const { idToken, email, displayName, uid } = req.body;

  try {
    // Verifica o token no Firebase Admin
    const decodedToken = await auth.verifyIdToken(idToken);
    if (decodedToken.uid !== uid) {
      return res.status(401).json({ error: "UID inválido" });
    }

    // Salva dados adicionais do usuário no Firestore (se ainda não existir)
    await db.collection("users").doc(uid).set(
      {
        email,
        displayName,
        createdAt: new Date(),
      },
      { merge: true }
    );

    // Cria sessão do usuário
    req.session.user = {
      uid,
      email,
      displayName,
      loginTime: new Date(),
    };

    console.log(`✅ Sessão criada para ${email} (registro)`);

    res.status(201).json({
      message: "Usuário registrado e logado com sucesso",
      user: req.session.user,
    });
  } catch (error) {
    console.error("❌ Erro no registro:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * 📌 POST /api/auth/login
 * Recebe idToken, valida no Firebase Admin e cria sessão Express
 */
router.post("/login", async (req, res) => {
  const { idToken, email, displayName, uid } = req.body;

  try {
    // Verifica o token do Firebase
    const decodedToken = await auth.verifyIdToken(idToken);
    if (decodedToken.uid !== uid) {
      return res.status(401).json({ error: "UID inválido" });
    }

    // Busca dados extras do Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists
      ? userDoc.data()
      : { email, displayName };

    // foto de perfil também seja carregada
    const photoURL = userData.photoURL || null;

    // Cria a sessão com foto se tiver
    req.session.user = {
      uid,
      email: userData.email,
      displayName: userData.displayName,
      photoURL, 
      loginTime: new Date(),
    };

    console.log(`✅ Sessão criada para ${email} (login)`);

    res.json({
      message: "Login bem-sucedido",
      user: req.session.user,
    });
  } catch (error) {
    console.error("❌ Erro no login:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * 📌 POST /api/auth/logout
 * Destroi a sessão do usuário
 */
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao encerrar sessão:", err);
      return res.status(500).json({ error: "Erro ao encerrar sessão" });
    }

    res.clearCookie("connect.sid");
    res.json({ message: "Logout realizado com sucesso" });
  });
});

/**
 * 📌 GET /api/auth/me
 * Verifica se o usuário possui sessão ativa
 */
router.get("/me", (req, res) => {
  if (req.session.user) {
    return res.json({ user: req.session.user });
  } else {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }
});

/**
 * 📌 POST /api/auth/update
 * Atualiza nome do usuário logado
 */
router.post("/update", async (req, res) => {
  const { idToken, displayName, uid, photoBase64 } = req.body;

  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.uid !== uid) {
      return res.status(401).json({ error: "UID inválido" });
    }

    // Atualiza no Firestore
    const updateData = { displayName, updatedAt: new Date() };
    if (photoBase64) {
      updateData.photoURL = photoBase64; // salva imagem como base64
    }

    await db.collection("users").doc(uid).set(updateData, { merge: true });

    // Atualiza sessão Express
    if (req.session.user) {
      req.session.user.displayName = displayName;
      if (photoBase64) req.session.user.photoURL = photoBase64;
    }

    console.log(`✅ Perfil atualizado: ${displayName}`);
    res.json({ message: "Perfil atualizado com sucesso", photoURL: photoBase64 || null });
  } catch (error) {
    console.error("❌ Erro ao atualizar perfil:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
