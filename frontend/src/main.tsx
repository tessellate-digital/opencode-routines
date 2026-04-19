import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

const html = document.documentElement;
const stored = (key: string, attr: string) => {
  const v = localStorage.getItem(key);
  if (v) html.setAttribute(attr, v);
};
stored('oc-theme', 'data-theme');
stored('oc-density', 'data-density');
stored('oc-status-style', 'data-status-style');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
