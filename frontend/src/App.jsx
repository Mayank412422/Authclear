import { useEffect } from "react";

import Dashboard from "./pages/Dashboard";
import { startKeepAlive } from "./services/keepAlive";

function App() {
  useEffect(() => startKeepAlive(), []);

  return <Dashboard />;
}

export default App;
