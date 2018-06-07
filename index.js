/* Used this codepen with some color and screen adjustment: https://codepen.io/nashvail/pen/wpGgXO */

// Some random colors
const colors = ["#ffccdd", "#514F59", "#5941A9", "#6D72C3", "#FFFFFF"];

const numBalls = 50;
const balls = [];

for (let i = 0; i < numBalls; i++) {
  let ball = document.createElement("div");
  ball.classList.add("ball");
  ball.style.background = colors[Math.floor(Math.random() * colors.length)];
  ball.style.left = `${Math.floor(Math.random() * 90)}vw`;
  ball.style.top = `${Math.floor(Math.random() * 75)}vh`;
  ball.style.transform = `scale(${Math.random()})`;
  ball.style.width = `${Math.random()}em`;
  ball.style.height = ball.style.width;
  
  balls.push(ball);
  document.body.append(ball);
}

// Keyframes
balls.forEach((el, i, ra) => {
  let to = {
    x: Math.random() * (i % 2 === 0 ? -11 : 11),
    y: Math.random() * 12
  };

  let anim = el.animate(
    [
      { transform: "translate(0, 0)" },
      { transform: `translate(${to.x}rem, ${to.y}rem)` }
    ],
    {
      duration: (Math.random() + 1) * 2000, // random duration
      direction: "alternate",
      fill: "both",
      iterations: Infinity,
      easing: "ease-in-out"
    }
  );
});


//onclick button zoom out
let zoomOutIndex = document.querySelector(".index-button")
let zoomOutProject = document.querySelector(".project-button")
let zoomOutContact = document.querySelector(".contact-button")

let zoomOutIndexButton = document.querySelector("#index-button")
let zoomOutProjectButton = document.querySelector("#project-button")
let zoomOutContactButton = document.querySelector("#contact-button")

let indexNav = document.querySelector("#index-nav")
let projectNav = document.querySelector("#project-nav")
let contactNav = document.querySelector("#contact-nav")

let index = document.querySelector("#index")
let projects = document.querySelector("#projects")
let contact = document.querySelector("#contact")

zoomOutIndex.addEventListener("click", (event) => {
    index.classList.remove("scale-in")
    index.classList.add("scale-away")
    
    contact.classList.remove("scale-in")
    contact.classList.add("scale-away")

    projects.classList.remove("hidden")
    projects.classList.add("scale-in")

    indexNav.classList.remove("active")
    projectNav.classList.add("active")
    contactNav.classList.remove("active")
})

zoomOutIndexButton.addEventListener("click", (event) => {
    index.classList.remove("scale-in")
    index.classList.add("scale-away")
    
    contact.classList.remove("scale-in")
    contact.classList.add("scale-away")

    projects.classList.remove("hidden")
    projects.classList.add("scale-in")

    indexNav.classList.remove("active")
    projectNav.classList.add("active")
    contactNav.classList.remove("active")    
})

zoomOutProject.addEventListener("click", (event) => {
    projects.classList.remove("scale-in")
    projects.classList.add("scale-away")

    index.classList.remove("scale-in")
    index.classList.add("scale-away")

    contact.classList.remove("hidden")
    contact.classList.add("scale-in")

    indexNav.classList.remove("active")
    projectNav.classList.remove("active")
    contactNav.classList.add("active")
})

zoomOutProjectButton.addEventListener("click", (event) => {
    projects.classList.remove("scale-in")
    projects.classList.add("scale-away")

    index.classList.remove("scale-in")
    index.classList.add("scale-away")

    contact.classList.remove("hidden")
    contact.classList.add("scale-in")
    
    indexNav.classList.remove("active")
    projectNav.classList.remove("active")
    contactNav.classList.add("active")
})

zoomOutContact.addEventListener("click", (event) => {
    contact.classList.remove("scale-in")
    contact.classList.add("scale-away")

    projects.classList.remove("scale-in")
    projects.classList.add("scale-away")

    index.classList.remove("scale-away")
    index.classList.add("scale-in")

    indexNav.classList.add("active")
    projectNav.classList.remove("active")
    contactNav.classList.remove("active")
})

zoomOutContactButton.addEventListener("click", (event) => {
    contact.classList.remove("scale-in")
    contact.classList.add("scale-away")

    projects.classList.remove("scale-in")
    projects.classList.add("scale-away")

    index.classList.remove("scale-away")
    index.classList.add("scale-in")

    indexNav.classList.add("active")
    projectNav.classList.remove("active")
    contactNav.classList.remove("active")
})

// Set bg music low to not bother everyone :)
let bg = document.getElementById("music").play()
bg.volume = 0.2