import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// YouTube blocks most music in embedded players on raw-IP pages, so always run on "localhost".
if (/^(127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  location.replace(`${location.protocol}//localhost:${location.port}${location.pathname}${location.search}`);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
