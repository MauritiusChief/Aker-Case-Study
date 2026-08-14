import { Link, Navigate, Route, Routes } from "react-router-dom";
import { PortfolioPage } from "./pages/PortfolioPage";
import { LeaseRiskPage } from "./pages/LeaseRiskPage";
import { PropertyDetailPage } from "./pages/PropertyDetailPage";

const navItems = [
  { to: "/portfolio", label: "Portfolio Overview" },
  { to: "/lease-risk", label: "Lease Risk" },
  { to: "/what-if", label: "What-if" },
];

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">Aker · Property Operations</div>
        <nav className="app-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/portfolio" replace />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/lease-risk" element={<LeaseRiskPage />} />
          <Route path="/properties/:propertyCode" element={<PropertyDetailPage />} />
          <Route path="/what-if" element={<ComingSoon title="What-if" />} />
        </Routes>
      </main>
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="placeholder">
      <h2>{title}</h2>
      <p>This page is implemented in a later phase.</p>
      <Link to="/portfolio" className="nav-link">
        Back to Portfolio
      </Link>
    </div>
  );
}
