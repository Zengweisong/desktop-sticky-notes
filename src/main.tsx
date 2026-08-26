import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

document.addEventListener("contextmenu", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
