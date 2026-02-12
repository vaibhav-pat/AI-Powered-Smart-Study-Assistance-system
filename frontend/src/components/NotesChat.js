import React, { useState, useEffect } from 'react';
import axios from 'axios';

const NotesChat = ({ user, onBack }) => {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchUserNotes();
  }, []);

  const fetchUserNotes = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/notes/my-notes`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      setUploadedFiles(response.data.notes || []);
      
    } catch (error) {
      console.error('Error fetching notes:', error);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && !file.name.toLowerCase().endsWith('.txt')) {
      alert('Please upload only PDF or TXT files');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/notes/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      if (response.data.success) {
        setMessages(prev => [...prev, {
          type: 'system',
          content: `Successfully uploaded "${response.data.note.originalName}" - ${response.data.note.chunksCount} chunks processed`
        }]);
        fetchUserNotes();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Upload failed';
      setMessages(prev => [...prev, {
        type: 'error',
        content: `Upload failed: ${errorMessage}`
      }]);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleSubmitQuestion = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    const userMessage = { type: 'user', content: question };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/notes/query`,
        { question },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (response.data.success) {
        const botMessage = {
          type: 'bot',
          content: response.data.answer,
          sources: response.data.sources
        };
        setMessages(prev => [...prev, botMessage]);
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Query failed';
      
      setMessages(prev => [...prev, {
        type: 'error',
        content: errorMessage
      }]);
    } finally {
      setLoading(false);
      setQuestion('');
    }
  };

  const deleteFile = async (noteId, filename) => {
    if (!window.confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(
        `${process.env.REACT_APP_API_URL}/notes/${noteId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      setMessages(prev => [...prev, {
        type: 'system',
        content: `Deleted "${filename}" successfully`
      }]);
      fetchUserNotes();
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Delete failed';
      setMessages(prev => [...prev, {
        type: 'error',
        content: `Delete failed: ${errorMessage}`
      }]);
    }
  };

  const formatText = (text) => {
    if (!text) return '';
    
    return text
      .replace(/(\d+\.\s)/g, '\n$1')
      .replace(/\.\s+([A-Z])/g, '.\n\n$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const renderFormattedText = (text) => {
    const formattedText = formatText(text);
    const lines = formattedText.split('\n');
    
    return lines.map((line, index) => {
      const isNumberedPoint = /^\d+\.\s/.test(line.trim());
      
      return (
        <React.Fragment key={index}>
          {isNumberedPoint ? (
            <div style={{ marginTop: '8px', marginBottom: '4px', fontWeight: '500' }}>
              {line.trim()}
            </div>
          ) : (
            <span>{line}</span>
          )}
          {index < lines.length - 1 && line.trim() && <br />}
        </React.Fragment>
      );
    });
  };

  const truncateText = (text, maxLength = 100) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="notes-page">
      <div className="notes-chat-container">
        <div className="chat-header">
          <button onClick={onBack} className="back-btn">← Back to Dashboard</button>
          <h2>Ask Questions from Your Notes</h2>
        </div>

        <div className="upload-section">
          <div className="upload-area">
            <input
              type="file"
              accept=".pdf,.txt"
              onChange={handleFileUpload}
              disabled={uploading}
              id="file-upload"
              className="file-input"
            />
            <label htmlFor="file-upload" className="file-upload-label">
              {uploading ? 'Uploading...' : 'Upload PDF or TXT file'}
            </label>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="uploaded-files">
              <h3>Your Notes ({uploadedFiles.length} files)</h3>
              <div className="files-list">
                {uploadedFiles.map((file) => (
                  <div key={file._id} className="file-item">
                    <div className="file-name">{file.originalName}</div>
                    <div className="file-info">
                      {file.chunksCount} chunks • {new Date(file.uploadedAt).toLocaleDateString()}
                    </div>
                    <button
                      onClick={() => deleteFile(file._id, file.originalName)}
                      className="delete-btn"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="chat-messages">
          {messages.length === 0 && uploadedFiles.length === 0 && (
            <div className="welcome-message">
              <p>Welcome! Upload your PDF or TXT notes first, then ask any questions about them.</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className={`message ${message.type}`}>
              <div className="message-content">
                {message.type === 'bot' ? (
                  <div className="bot-answer">
                    <div className="answer-text">
                      {renderFormattedText(message.content)}
                    </div>
                    {message.sources && message.sources.length > 0 && (
                      <div className="sources">
                        <strong>Sources:</strong>
                        {message.sources.map((source, idx) => (
                          <div key={idx} className="source-item">
                            <strong>{source.filename}</strong>
                            <div className="source-preview">
                              {truncateText(source.content_preview, 120)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  renderFormattedText(message.content)
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="message bot">
              <div className="message-content">
                <div className="typing-indicator">
                  <span>Thinking</span>
                  <span className="dots">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmitQuestion} className="question-form">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your notes..."
            disabled={loading || uploadedFiles.length === 0}
            className="question-input"
          />
          <button 
            type="submit" 
            disabled={loading || !question.trim() || uploadedFiles.length === 0}
            className="send-btn"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </form>

        {uploadedFiles.length === 0 && (
          <div className="no-files-message">
            Please upload some notes first to start asking questions.
          </div>
        )}
      </div>
    </div>
  );
};

export default NotesChat;