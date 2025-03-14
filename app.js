document.addEventListener("DOMContentLoaded", function () {
  const db = firebase.firestore();
  const storage = firebase.storage();

  // Global variables
  let currentVisitor = null;
  let currentVisitorDocId = null;
  let stream = null;
  let onboardingData = {}; // To store additional details

  // --- Load face-api.js Models (SSD MobileNet v1) ---
  let modelsLoaded = false;
  async function loadFaceApiModels() {
    if (!modelsLoaded) {
      await faceapi.nets.ssdMobilenetv1.loadFromUri("/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      modelsLoaded = true;
    }
  }

  // --- Capture Face Descriptor ---
  async function captureFaceDescriptor(videoId) {
    await loadFaceApiModels();
    const video = document.getElementById(videoId);
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.SsdMobilenetv1Options())
      .withFaceLandmarks()
      .withFaceDescriptor();
    return detection ? Array.from(detection.descriptor) : null;
  }

  // --- Capture Snapshot from Video ---
  async function captureSnapshot(videoId) {
    const video = document.getElementById(videoId);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, "image/jpeg");
    });
  }

  // --- Upload Image to Firebase Storage ---
  async function uploadImage(blob, path) {
    const fileRef = storage.ref().child(path);
    await fileRef.put(blob);
    return await fileRef.getDownloadURL();
  }

  // --- Delete Image from Firebase Storage ---
  async function deleteImage(path) {
    try {
      await storage.ref().child(path).delete();
    } catch (err) {
      console.error("Error deleting old image:", err);
    }
  }

  // --- Update Visitor Photo ---
  async function updateVisitorPhoto(visitorId) {
    const docRef = db.collection("visitors").doc(visitorId);
    const docSnap = await docRef.get();
    const data = docSnap.data();
    const blob = await captureSnapshot("video");
    const newPath = `visitorPhotos/${visitorId}_${Date.now()}.jpg`;
    const newPhotoURL = await uploadImage(blob, newPath);
    // Delete previous photo if exists
    if (data.photoPath) {
      await deleteImage(data.photoPath);
    }
    await docRef.update({ photo: newPhotoURL, photoPath: newPath });
    return newPhotoURL;
  }

  // --- Utility: Show/Hide Screens ---
  function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.remove("active");
    });
    if (screenId) {
      const el = document.getElementById(screenId);
      if (el) el.classList.add("active");
    }
  }

  // --- Populate Custom Suggestion Lists ---
  async function populateVisitorSuggestions() {
    const container = document.getElementById("visitor-suggestions-container");
    if (!container) return;
    container.innerHTML = "";
    const snapshot = await db.collection("visitors").get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.name) {
        const div = document.createElement("div");
        div.classList.add("suggestion");
        const img = document.createElement("img");
        img.src = data.photo || "placeholder.jpg";
        const span = document.createElement("span");
        span.innerText = data.name;
        div.appendChild(img);
        div.appendChild(span);
        div.addEventListener("click", () => {
          document.getElementById("visitor-input").value = data.name;
        });
        container.appendChild(div);
      }
    });
  }

  async function populateCheckoutSuggestions() {
    const container = document.getElementById("checkout-suggestions-container");
    if (!container) return;
    container.innerHTML = "";
    const snapshot = await db
      .collection("visitors")
      .where("checkedIn", "==", true)
      .get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.name) {
        const div = document.createElement("div");
        div.classList.add("suggestion");
        const img = document.createElement("img");
        img.src = data.photo || "placeholder.jpg";
        const span = document.createElement("span");
        span.innerText = data.name;
        div.appendChild(img);
        div.appendChild(span);
        div.addEventListener("click", () => {
          document.getElementById("checkout-input").value = data.name;
        });
        container.appendChild(div);
      }
    });
  }

  // --- Visitor Sign In Flow ---
  async function startSignInFlow() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("video");
      video.srcObject = stream;
      showScreen("camera-screen");
      // Show skip button always
      // Allow a 2-second delay for faster processing
      setTimeout(async () => {
        const descriptor = await captureFaceDescriptor("video");
        if (!descriptor) {
          alert("No face detected. Please try again or enter manually.");
          showScreen("manual-signin-screen");
          populateVisitorSuggestions();
          return;
        }
        let matched = null;
        const snapshot = await db.collection("visitors").get();
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.descriptor) {
            const distance = faceapi.euclideanDistance(
              descriptor,
              data.descriptor
            );
            if (distance < 0.4) {
              // Adjust threshold as needed
              matched = { id: doc.id, name: data.name };
            }
          }
        });
        if (matched) {
          currentVisitor = matched.name;
          currentVisitorDocId = matched.id;
          onboardingData.name = matched.name;
          document.getElementById("visitor-name").innerText = matched.name;
          // Show confirmation prompt with Yes/Skip buttons
          document.getElementById("face-confirmation").style.display = "block";
        } else {
          alert("Face not recognized. Please sign in manually.");
          showScreen("manual-signin-screen");
          populateVisitorSuggestions();
        }
      }, 2000);
    } catch (err) {
      document.getElementById("camera-error").style.display = "block";
      console.error("Camera error:", err);
    }
  }

  async function finishManualSignIn() {
    const name = document.getElementById("visitor-input").value.trim();
    if (!name) {
      alert("Please enter your name.");
      return;
    }
    onboardingData.name = name;
    let visitorId;
    const snapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (snapshot.empty) {
      const docRef = await db.collection("visitors").add({
        name: name,
        checkedIn: true,
        timestamp: new Date().toISOString(),
      });
      visitorId = docRef.id;
    } else {
      visitorId = snapshot.docs[0].id;
      await db
        .collection("visitors")
        .doc(visitorId)
        .update({ checkedIn: true });
    }
    currentVisitor = name;
    currentVisitorDocId = visitorId;
    // Proceed to onboarding flow for additional details (always ask reason)
    showScreen("onboarding-4");
  }

  // --- Onboarding Flow: Reason for Visit ---
  document.querySelectorAll(".reason-btn").forEach((button) => {
    button.addEventListener("click", () => {
      onboardingData.reason = button.getAttribute("data-reason");
      showScreen("onboarding-5");
    });
  });

  // --- Onboarding Flow: Car Registration & Complete Sign In ---
  document
    .getElementById("onboarding-5-finish")
    .addEventListener("click", async () => {
      onboardingData.carReg = document.getElementById("car-reg").value.trim();
      // Update visitor record with reason and car reg, and capture/update photo
      await updateVisitorPhoto(currentVisitorDocId);
      await db
        .collection("visitors")
        .doc(currentVisitorDocId)
        .update({
          reason: onboardingData.reason || "",
          carReg: onboardingData.carReg || "",
        });
      await db.collection("signIns").add({
        visitorId: currentVisitorDocId,
        timestamp: new Date().toISOString(),
        reason: onboardingData.reason || "",
        carReg: onboardingData.carReg || "",
      });
      document.getElementById("welcome-message").innerText =
        "✅ Welcome, " + onboardingData.name + "!";
      showScreen("confirmation-screen");
      setTimeout(() => location.reload(), 3000);
    });

  // --- Visitor Check Out Flow ---
  async function startCheckOutFlow() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("video");
      video.srcObject = stream;
      showScreen("camera-screen");
      setTimeout(async () => {
        const descriptor = await captureFaceDescriptor("video");
        let matched = null;
        const snapshot = await db.collection("visitors").get();
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.descriptor) {
            const distance = faceapi.euclideanDistance(
              descriptor,
              data.descriptor
            );
            if (distance < 0.4) {
              matched = { id: doc.id, name: data.name };
            }
          }
        });
        if (matched) {
          await db
            .collection("visitors")
            .doc(matched.id)
            .update({ checkedIn: false });
          await db.collection("checkOuts").add({
            visitorId: matched.id,
            timestamp: new Date().toISOString(),
          });
          alert("✅ " + matched.name + " checked out.");
          showScreen("confirmation-screen");
          setTimeout(() => location.reload(), 3000);
        } else {
          alert("Face not recognized. Please check out manually.");
          showScreen("manual-checkout-screen");
          populateCheckoutSuggestions();
        }
      }, 2000);
    } catch (err) {
      document.getElementById("camera-error").style.display = "block";
      console.error("Camera error:", err);
    }
  }

  async function finishManualCheckOut() {
    const name = document.getElementById("checkout-input").value.trim();
    if (!name) {
      alert("Please enter your name.");
      return;
    }
    const snapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (snapshot.empty) {
      alert("No record found for " + name);
      return;
    }
    const visitorId = snapshot.docs[0].id;
    await db.collection("visitors").doc(visitorId).update({ checkedIn: false });
    await db.collection("checkOuts").add({
      visitorId: visitorId,
      timestamp: new Date().toISOString(),
    });
    alert("✅ " + name + " checked out.");
    showScreen("confirmation-screen");
    setTimeout(() => location.reload(), 3000);
  }

  // --- Confirmation Buttons for Recognized Face ---
  document.getElementById("confirm-btn").addEventListener("click", () => {
    // Proceed to onboarding even if face recognized to ask reason for visit.
    if (currentVisitor) {
      onboardingData.name = currentVisitor;
      showScreen("onboarding-4");
    }
  });
  document.getElementById("skip-btn").addEventListener("click", () => {
    showScreen("manual-signin-screen");
    populateVisitorSuggestions();
  });

  // --- Always-Visible Skip Button during Scanning ---
  document.getElementById("camera-skip-btn").addEventListener("click", () => {
    showScreen("manual-signin-screen");
    populateVisitorSuggestions();
  });

  // --- Event Listeners for Kiosk Buttons ---
  document
    .getElementById("sign-in-btn")
    .addEventListener("click", startSignInFlow);
  document
    .getElementById("finish-signin-btn")
    .addEventListener("click", finishManualSignIn);
  document
    .getElementById("check-out-btn")
    .addEventListener("click", startCheckOutFlow);
  document
    .getElementById("finish-checkout-btn")
    .addEventListener("click", finishManualCheckOut);

  // --- Staff Functions (unchanged for now) ---
  let currentStaff = null;
  let capturedStaffDescriptor = null;
  async function startStaffCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("staff-video");
      video.srcObject = stream;
      setTimeout(simulateStaffRecognition, 2000);
    } catch (err) {
      document.getElementById("staff-camera-error").style.display = "block";
      console.error("Staff camera error:", err);
    }
  }

  async function simulateStaffRecognition() {
    const capturedDescriptor = await captureFaceDescriptor("staff-video");
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
        if (data.descriptor) {
          const distance = faceapi.euclideanDistance(
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
      document.getElementById("staff-face-confirmation").style.display =
        "block";
    } else {
      capturedStaffDescriptor = capturedDescriptor;
      alert("Staff face not recognized. Please register new staff.");
      showScreen(null);
    }
  }

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
      let lastEventType = "signOut";
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
      if (stream) stream.getTracks().forEach((t) => t.stop());
      showScreen(null);
    } catch (error) {
      console.error("Error processing staff event:", error);
    }
  }

  // --- Staff Event Listeners ---
  document.getElementById("staff-sign-in-btn").addEventListener("click", () => {
    showScreen("staff-camera-screen");
    startStaffCamera();
  });
  document
    .getElementById("staff-confirm-btn")
    .addEventListener("click", async () => {
      if (!currentStaff) return;
      processStaffEvent(currentStaff);
    });
  document.getElementById("staff-skip-btn").addEventListener("click", () => {
    showScreen(null);
  });
});
