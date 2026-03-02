if(localStorage.getItem("role") !== "manager"){
  window.location.href = "/main.html";
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  // your firebase config here
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const wasteForm = document.getElementById("wasteForm");
const wasteList = document.getElementById("wasteList");

const todayWaste = document.getElementById("todayWaste");
const weekWaste = document.getElementById("weekWaste");
const topWaste = document.getElementById("topWaste");

const wasteRef = collection(db, "waste");

wasteForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const item = document.getElementById("wasteItem").value;
  const qty = Number(document.getElementById("wasteQty").value);
  const reason = document.getElementById("wasteReason").value;

  await addDoc(wasteRef, {
    item,
    qty,
    reason,
    date: new Date()
  });

  wasteForm.reset();
  loadWaste();
});

async function loadWaste(){
  wasteList.innerHTML = "";

  const snapshot = await getDocs(wasteRef);

  let todayTotal = 0;
  let weekTotal = 0;
  const itemCounts = {};

  const today = new Date();
  const startOfWeek = new Date();
  startOfWeek.setDate(today.getDate() - today.getDay());

  snapshot.forEach(doc => {
    const data = doc.data();
    const wasteDate = data.date.toDate();

    const div = document.createElement("div");
    div.className = "waste-item";
    div.innerHTML = `
      <span>${data.item} (${data.reason})</span>
      <strong>${data.qty}</strong>
    `;
    wasteList.appendChild(div);

    if(wasteDate.toDateString() === today.toDateString()){
      todayTotal += data.qty;
    }

    if(wasteDate >= startOfWeek){
      weekTotal += data.qty;
    }

    itemCounts[data.item] = (itemCounts[data.item] || 0) + data.qty;
  });

  todayWaste.innerText = todayTotal;
  weekWaste.innerText = weekTotal;

  let max = 0;
  let topItem = "-";
  for(const item in itemCounts){
    if(itemCounts[item] > max){
      max = itemCounts[item];
      topItem = item;
    }
  }

  topWaste.innerText = topItem;
}

loadWaste();