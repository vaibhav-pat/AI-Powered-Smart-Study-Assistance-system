import React from 'react';

const Dashboard = ({ user, onLogout, onNotesClick, onYouTubeClick }) => {
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    onLogout();
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-container">
        <div className="header">
          <div>
            <h1>RAG Notes Dashboard</h1>
            <div className="user-info">Welcome, {user.name}</div>
          </div>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
        
        <div className="feature-cards">
          <div className="feature-card" onClick={onNotesClick}>
            <h3>Ask Doubt from Notes</h3>
            <p>Upload your PDF or TXT notes and ask questions. Get accurate answers from your study materials using RAG technology.</p>
            <div className="card-status">Available</div>
          </div>
          
          <div className="feature-card" onClick={onYouTubeClick}>
            <h3>Ask Doubt from YouTube Video</h3>
            <p>Enter a YouTube video URL and ask questions about the video content based on its transcript. Supports English and Hindi.</p>
            <div className="card-status">Available</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;