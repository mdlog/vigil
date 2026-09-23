import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { legacyDashboardUrl } from '../nav';
import '../styles/base.css';
import '../styles/landing.css';
import { Home } from './Home';

// Before the landing existed, this URL was the dashboard: keep old ?rpc= / ?poll= links on live data.
const legacy = legacyDashboardUrl(location);
if (legacy) location.replace(legacy);
else createRoot(document.getElementById('root')!).render(<StrictMode><Home /></StrictMode>);
