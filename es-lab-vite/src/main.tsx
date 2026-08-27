import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StoreProvider } from './store/StoreContext';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
