const firebaseConfig = {
  apiKey: "AIzaSyAJ5lJoueMwV8osZmwO-hqibOqlNXfqkqM",
  authDomain: "sign-in-app-14d9d.firebaseapp.com",
  projectId: "sign-in-app-14d9d",
  storageBucket: "sign-in-app-14d9d.firebasestorage.app",
  messagingSenderId: "352962654007",
  appId: "1:352962654007:web:16a8b36f129a961f78b4b2",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Global variables to track the current visitor session
let currentVisitor = null; // Visitor's name
let currentVisitorDocId = null; // Visitor's document ID from the "visitors" collection
let stream = null;

// Dummy function to simulate capturing a face descriptor.
// Replace this with your actual face recognition logic.
function captureFaceDescriptor() {
  return [0.1, 0.2, 0.3, 0.4, 0.5];
}

// Utility to switch visible screens.
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  document.getElementById(screenId).classList.add("active");
}

// Start camera and simulate face detection.
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.getElementById("video");
    video.srcObject = stream;
    // Simulate face recognition delay.
    setTimeout(simulateFaceRecognition, 3000);
  } catch (err) {
    document.getElementById("camera-error").style.display = "block";
    console.error("Camera error:", err);
  }
}

// Dummy face recognition simulation.
function simulateFaceRecognition() {
  // For this demo, assume the face is detected as "John Smith".
  const detectedName = "John Smith";
  // If the visitor is already signed in, proceed with auto check-out.
  if (currentVisitor && currentVisitor === detectedName) {
    autoCheckOutVisitor(detectedName);
  } else {
    // Capture the face descriptor.
    const descriptor = captureFaceDescriptor();
    // Show the confirmation prompt.
    document.getElementById("visitor-name").innerText = detectedName;
    document.getElementById("face-confirmation").style.display = "block";
  }
}

// Check in a visitor.
// This function first ensures the visitor exists in the "visitors" collection.
// Then it logs a new sign-in event in the "signIns" collection.
async function checkInVisitor(name, descriptor) {
  try {
    let visitorDoc;
    // Check if this visitor already exists (using the name as a simple identifier).
    const visitorQuerySnapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (visitorQuerySnapshot.empty) {
      // Add a new visitor to the "visitors" collection.
      const docRef = await db.collection("visitors").add({
        name: name,
        descriptor: descriptor,
      });
      visitorDoc = { id: docRef.id, data: { name, descriptor } };
    } else {
      // Use the first matching document.
      visitorDoc = {
        id: visitorQuerySnapshot.docs[0].id,
        data: visitorQuerySnapshot.docs[0].data(),
      };
    }

    // Log the sign-in event.
    await db.collection("signIns").add({
      visitorId: visitorDoc.id,
      timestamp: new Date().toISOString(),
    });

    // Set current session details.
    currentVisitor = name;
    currentVisitorDocId = visitorDoc.id;

    // Show confirmation.
    document.getElementById("welcome-message").innerText =
      "✅ Welcome, " + name + "!";
    showScreen("confirmation-screen");

    // Stop camera stream.
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    // Return to the home screen after 3 seconds.
    setTimeout(() => {
      showScreen("home-screen");
    }, 3000);
  } catch (error) {
    console.error("Error during check-in:", error);
  }
}

// Auto check-out a visitor.
// This logs a check-out event in the "checkOuts" collection.
async function autoCheckOutVisitor(name) {
  try {
    // Log the check-out event.
    await db.collection("checkOuts").add({
      visitorId: currentVisitorDocId,
      timestamp: new Date().toISOString(),
    });
    alert("✅ " + name + " has been checked out.");

    // Clear the current session.
    currentVisitor = null;
    currentVisitorDocId = null;

    // Stop the camera stream.
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    showScreen("home-screen");
  } catch (error) {
    console.error("Error during auto check-out:", error);
  }
}

// Event listeners for button actions.
document.getElementById("start-button").addEventListener("click", () => {
  showScreen("camera-screen");
  startCamera();
});

document.getElementById("manual-home-button").addEventListener("click", () => {
  showScreen("manual-signin-screen");
});

document.getElementById("yes-button").addEventListener("click", () => {
  // User confirms detected identity.
  const name = document.getElementById("visitor-name").innerText;
  const descriptor = captureFaceDescriptor();
  checkInVisitor(name, descriptor);
});

document.getElementById("no-button").addEventListener("click", () => {
  // Fallback to manual sign-in.
  showScreen("manual-signin-screen");
});

document.getElementById("submit-name").addEventListener("click", () => {
  const name = document.getElementById("visitor-input").value.trim();
  if (name) {
    const descriptor = captureFaceDescriptor();
    checkInVisitor(name, descriptor);
  } else {
    alert("Please enter your name.");
  }
});
