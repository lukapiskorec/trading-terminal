import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { Analytics } from "@/pages/Analytics";
import { Dashboard } from "@/pages/Dashboard";
import { Placeholder } from "@/pages/Placeholder";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="rules" element={<Placeholder title="Rules" />} />
          <Route path="backtest" element={<Placeholder title="Backtest" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
