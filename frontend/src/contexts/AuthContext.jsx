import { createContext, useContext, useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext();

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function signup(email, password) {
    if (!auth) {
      throw new Error("Firebase auth not initialized. Check your .env configuration.");
    }
    
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    if (!db) {
      console.warn("Firestore (db) is not initialized. User document will not be created.");
    } else if (!user) {
      console.warn("User is null. User document will not be created.");
    } else {
      try {
        console.log("Creating user document in Firestore for:", user.uid);
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          const userData = {
            email: user.email,
            role: "user",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          console.log("Setting user document with data:", userData);
          await setDoc(userDocRef, userData);
          console.log("User document created successfully in Firestore");
        } else {
          console.log("User document already exists in Firestore");
        }
      } catch (error) {
        console.error("Error creating user document in Firestore:", error);
        console.error("Error code:", error.code);
        console.error("Error message:", error.message);
        console.error("Full error:", error);
        throw new Error(`Failed to create user document: ${error.message}`);
      }
    }
    
    return userCredential;
  }

  function login(email, password) {
    if (!auth) {
      throw new Error("Firebase auth not initialized. Check your .env configuration.");
    }
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    if (!auth) {
      throw new Error("Firebase auth not initialized. Check your .env configuration.");
    }
    return signOut(auth);
  }

  useEffect(() => {
    if (!auth) {
      console.error("Firebase auth is not initialized");
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      if (!db) {
        console.warn("Firestore (db) is not initialized. Cannot check/create user document.");
      } else if (user) {
        try {
          console.log("Checking user document in Firestore for:", user.uid);
          const userDocRef = doc(db, "users", user.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            const userData = {
              email: user.email,
              role: "user",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            console.log("Creating user document for existing user with data:", userData);
            await setDoc(userDocRef, userData);
            console.log("User document created in Firestore for existing user");
          } else {
            console.log("User document already exists in Firestore");
          }
        } catch (error) {
          console.error("Error checking/creating user document in Firestore:", error);
          console.error("Error code:", error.code);
          console.error("Error message:", error.message);
          console.error("Full error:", error);
        }
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    signup,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
