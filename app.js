// Firebase configuration and initialization
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

// Global variables for visitor and staff sessions.
let currentVisitor = null;
let currentVisitorDocId = null;
let currentStaff = null; // For staff sign in/out
let stream = null;
let onboardingData = {}; // For visitor onboarding

// Ensure face-api models are loaded only once.
let modelsLoaded = false;
async function loadFaceApiModels() {
  if (!modelsLoaded) {
    await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
    await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
    await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
    modelsLoaded = true;
  }
}

// Capture a face descriptor for visitor (from #video)
async function captureFaceDescriptor() {
  await loadFaceApiModels();
  const video = document.getElementById("video");
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (detection) {
    return Array.from(detection.descriptor);
  }
  return null;
}

// Capture a face descriptor for staff (from #staff-video)
async function captureFaceDescriptorForStaff() {
  await loadFaceApiModels();
  const video = document.getElementById("staff-video");
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (detection) {
    return Array.from(detection.descriptor);
  }
  return null;
}

// Compute Euclidean distance between two descriptor arrays.
function computeEuclideanDistance(arr1, arr2) {
  let sum = 0;
  const len = Math.min(arr1.length, arr2.length);
  for (let i = 0; i < len; i++) {
    const diff = arr1[i] - arr2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Utility to show a specific screen.
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  if (screenId) {
    document.getElementById(screenId).classList.add("active");
  }
}

// Visitor Camera – start video and simulate visitor face recognition.
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.getElementById("video");
    video.srcObject = stream;
    setTimeout(simulateFaceRecognition, 3000);
  } catch (err) {
    document.getElementById("camera-error").style.display = "block";
    console.error("Camera error:", err);
  }
}

async function simulateFaceRecognition() {
  const capturedDescriptor = await captureFaceDescriptor();
  if (!capturedDescriptor) {
    console.error("No face detected");
    return;
  }
  let matchedVisitor = null;
  let bestDistance = 0.3;
  try {
    const querySnapshot = await db.collection("visitors").get();
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.descriptor && Array.isArray(data.descriptor)) {
        const distance = computeEuclideanDistance(
          capturedDescriptor,
          data.descriptor
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          matchedVisitor = {
            id: doc.id,
            name: data.name,
            descriptor: data.descriptor,
          };
        }
      }
    });
  } catch (error) {
    console.error("Error fetching visitors:", error);
  }
  if (matchedVisitor) {
    currentVisitor = matchedVisitor.name;
    currentVisitorDocId = matchedVisitor.id;
    document.getElementById("visitor-name").innerText = matchedVisitor.name;
    document.getElementById("face-confirmation").style.display = "block";
  } else {
    alert("Face not recognized. Please complete onboarding.");
    showScreen("onboarding-1");
  }
}

// Staff Camera – start video and simulate staff face recognition.
async function startStaffCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.getElementById("staff-video");
    video.srcObject = stream;
    setTimeout(simulateStaffRecognition, 3000);
  } catch (err) {
    document.getElementById("staff-camera-error").style.display = "block";
    console.error("Staff camera error:", err);
  }
}

async function simulateStaffRecognition() {
  const capturedDescriptor = await captureFaceDescriptorForStaff();
  if (!capturedDescriptor) {
    console.error("No face detected for staff");
    return;
  }
  let matchedStaff = null;
  let bestDistance = 0.3;
  try {
    const querySnapshot = await db.collection("staff").get();
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.descriptor && Array.isArray(data.descriptor)) {
        const distance = computeEuclideanDistance(
          capturedDescriptor,
          data.descriptor
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          matchedStaff = {
            id: doc.id,
            name: data.name,
            descriptor: data.descriptor,
          };
        }
      }
    });
  } catch (error) {
    console.error("Error fetching staff:", error);
  }
  if (matchedStaff) {
    currentStaff = matchedStaff;
    document.getElementById("staff-name").innerText = matchedStaff.name;
    document.getElementById("staff-face-confirmation").style.display = "block";
  } else {
    alert("Staff face not recognized. Please try again.");
    showScreen(null);
  }
}

// Process a staff event: toggle sign in/out based on last event today.
async function processStaffEvent(staff) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const snapshot = await db
      .collection("staffEvents")
      .where("staffId", "==", staff.id)
      .where("timestamp", ">=", today.toISOString())
      .where("timestamp", "<", tomorrow.toISOString())
      .orderBy("timestamp", "desc")
      .get();
    let lastEventType = "signOut"; // default if none
    if (!snapshot.empty) {
      lastEventType = snapshot.docs[0].data().type;
    }
    const newEventType = lastEventType === "signIn" ? "signOut" : "signIn";
    await db.collection("staffEvents").add({
      staffId: staff.id,
      timestamp: new Date().toISOString(),
      type: newEventType,
    });
    alert(
      `Staff ${staff.name} ${
        newEventType === "signIn" ? "signed in" : "signed out"
      }.`
    );
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    showScreen(null);
  } catch (error) {
    console.error("Error processing staff event:", error);
  }
}

// Visitor Check In/Out functions
async function checkInVisitor(data, descriptor) {
  try {
    let fullName,
      extraData = {};
    if (typeof data === "object") {
      fullName = data.firstName + " " + data.lastName;
      extraData = {
        company: data.company,
        reason: data.reason,
        carReg: data.carReg,
      };
    } else {
      fullName = data;
    }
    let visitorDoc;
    const visitorQuerySnapshot = await db
      .collection("visitors")
      .where("name", "==", fullName)
      .get();
    if (visitorQuerySnapshot.empty) {
      const docRef = await db.collection("visitors").add({
        name: fullName,
        descriptor: descriptor,
        ...extraData,
        checkedIn: true,
      });
      visitorDoc = {
        id: docRef.id,
        data: { name: fullName, ...extraData, checkedIn: true },
      };
    } else {
      visitorDoc = {
        id: visitorQuerySnapshot.docs[0].id,
        data: visitorQuerySnapshot.docs[0].data(),
      };
      await db
        .collection("visitors")
        .doc(visitorDoc.id)
        .update({ checkedIn: true });
    }
    await db.collection("signIns").add({
      visitorId: visitorDoc.id,
      timestamp: new Date().toISOString(),
    });
    currentVisitor = fullName;
    currentVisitorDocId = visitorDoc.id;
    document.getElementById("welcome-message").innerText =
      "✅ Welcome, " + fullName + "!";
    showScreen("confirmation-screen");
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setTimeout(() => {
      showScreen(null);
    }, 3000);
  } catch (error) {
    console.error("Error during check-in:", error);
  }
}

async function autoCheckOutVisitor(name) {
  try {
    await db
      .collection("visitors")
      .doc(currentVisitorDocId)
      .update({ checkedIn: false });
    await db.collection("checkOuts").add({
      visitorId: currentVisitorDocId,
      timestamp: new Date().toISOString(),
    });
    alert("✅ " + name + " has been checked out.");
    currentVisitor = null;
    currentVisitorDocId = null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    showScreen(null);
  } catch (error) {
    console.error("Error during auto check-out:", error);
  }
}

// --- Event Listeners ---

// Visitor Sign In/Out
document.getElementById("sign-in-btn").addEventListener("click", () => {
  showScreen("camera-screen");
  startCamera();
});
document.getElementById("sign-out-btn").addEventListener("click", () => {
  if (currentVisitor) {
    autoCheckOutVisitor(currentVisitor);
  } else {
    alert("No visitor is currently signed in.");
  }
});
document.getElementById("yes-btn").addEventListener("click", async () => {
  const name = document.getElementById("visitor-name").innerText;
  const descriptor = await captureFaceDescriptor();
  if (descriptor) {
    checkInVisitor(name, descriptor);
  }
});
document.getElementById("no-btn").addEventListener("click", () => {
  showScreen("onboarding-1");
});

// Visitor Onboarding Flow
document.getElementById("onboarding-1-next").addEventListener("click", () => {
  const firstName = document.getElementById("first-name").value.trim();
  if (firstName) {
    onboardingData.firstName = firstName;
    showScreen("onboarding-2");
  } else {
    alert("Please enter your first name.");
  }
});
document.getElementById("onboarding-2-next").addEventListener("click", () => {
  const lastName = document.getElementById("last-name").value.trim();
  if (lastName) {
    onboardingData.lastName = lastName;
    showScreen("onboarding-3");
  } else {
    alert("Please enter your last name.");
  }
});
document.getElementById("onboarding-3-next").addEventListener("click", () => {
  const company = document.getElementById("company").value.trim();
  if (company) {
    onboardingData.company = company;
    showScreen("onboarding-4");
  } else {
    alert("Please enter your company.");
  }
});
document.querySelectorAll(".reason-btn").forEach((button) => {
  button.addEventListener("click", () => {
    onboardingData.reason = button.getAttribute("data-reason");
    showScreen("onboarding-5");
  });
});
document.getElementById("onboarding-5-finish").addEventListener("click", () => {
  const carReg = document.getElementById("car-reg").value.trim();
  onboardingData.carReg = carReg;
  captureFaceDescriptor().then((descriptor) => {
    checkInVisitor(onboardingData, descriptor);
  });
});

// Staff Sign In/Out
document.getElementById("staff-sign-in-btn").addEventListener("click", () => {
  showScreen("staff-camera-screen");
  startStaffCamera();
});
document.getElementById("staff-yes-btn").addEventListener("click", async () => {
  if (!currentStaff) return;
  processStaffEvent(currentStaff);
});
document.getElementById("staff-no-btn").addEventListener("click", () => {
  showScreen(null);
});
