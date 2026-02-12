import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import NotesChat from './components/NotesChat';
import YouTubeChat from './components/YouTubeChat';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('login');
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      setCurrentView('dashboard');
    }
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    setCurrentView('dashboard');
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView('login');
  };

  const handleNotesClick = () => {
    setCurrentView('notes-chat');
  };

  const handleYouTubeClick = () => {
    setCurrentView('youtube-chat');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
  };

  const switchToRegister = () => setCurrentView('register');
  const switchToLogin = () => setCurrentView('login');

  if (currentView === 'notes-chat' && user) {
    return <NotesChat user={user} onBack={handleBackToDashboard} />;
  }

  if (currentView === 'youtube-chat' && user) {
    return <YouTubeChat user={user} onBack={handleBackToDashboard} />;
  }

  if (currentView === 'dashboard' && user) {
    return (
      <Dashboard 
        user={user} 
        onLogout={handleLogout} 
        onNotesClick={handleNotesClick}
        onYouTubeClick={handleYouTubeClick}
      />
    );
  }

  if (currentView === 'register') {
    return <Register switchToLogin={switchToLogin} />;
  }

  return <Login switchToRegister={switchToRegister} onLogin={handleLogin} />;
}

export default App;