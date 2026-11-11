import { wiringSummary } from "./wiring";

export function App() {
  return (
    <main className="app">
      <h1>Baize</h1>
      <p>Pool and snooker shot diagram editor</p>
      <p className="wiring">{wiringSummary()}</p>
    </main>
  );
}
