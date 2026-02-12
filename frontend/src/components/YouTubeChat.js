import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const YouTubeChat = ({ user, onBack }) => {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [processedVideos, setProcessedVideos] = useState([]);
  const [processing, setProcessing] = useState(false);
  
  // Form state
  const [activeTab, setActiveTab] = useState('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [pastedTranscript, setPastedTranscript] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoUrlOptional, setVideoUrlOptional] = useState('');
  
  // Ref for scrolling to chat
  const chatSectionRef = useRef(null);

  useEffect(() => {
    fetchUserVideos();
  }, []);

  const fetchUserVideos = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/youtube/my-videos`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setProcessedVideos(response.data.videos || []);
    } catch (error) {
      console.error('Error fetching videos:', error);
    }
  };

  const scrollToChat = () => {
    setTimeout(() => {
      chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const extractVideoId = (url) => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    
    for (let pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const handleUrlProcess = async (e) => {
    e.preventDefault();
    if (!videoUrl.trim()) return;

    const videoId = extractVideoId(videoUrl.trim());
    if (!videoId) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: 'Invalid YouTube URL or Video ID.'
      }]);
      scrollToChat();
      return;
    }

    const existingVideo = processedVideos.find(v => v.videoId === videoId);
    if (existingVideo) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: `Video already processed: "${existingVideo.title}"`
      }]);
      scrollToChat();
      return;
    }

    setProcessing(true);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/youtube/process`,
        { videoUrl: videoUrl.trim(), language: 'english' },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setMessages(prev => [...prev, {
          type: 'system',
          content: `Successfully processed "${response.data.video.title}" - ${response.data.video.chunksCount} chunks created`
        }]);
        setVideoUrl('');
        fetchUserVideos();
        scrollToChat();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Video processing failed';
      setMessages(prev => [...prev, {
        type: 'error',
        content: `${errorMessage}. Try the "Paste Transcript" option instead.`
      }]);
      scrollToChat();
    } finally {
      setProcessing(false);
    }
  };

  const handlePasteProcess = async (e) => {
    e.preventDefault();
    if (!pastedTranscript.trim()) return;

    if (pastedTranscript.trim().length < 50) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: 'Transcript is too short. Please paste a complete transcript (at least 50 characters).'
      }]);
      scrollToChat();
      return;
    }

    setProcessing(true);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/youtube/process-pasted`,
        { 
          transcriptText: pastedTranscript.trim(),
          videoTitle: videoTitle.trim() || "Pasted Video Transcript",
          videoUrl: videoUrlOptional.trim()
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setMessages(prev => [...prev, {
          type: 'system',
          content: `Successfully processed "${response.data.video.title}" - ${response.data.video.chunksCount} chunks created`
        }]);
        setPastedTranscript('');
        setVideoTitle('');
        setVideoUrlOptional('');
        fetchUserVideos();
        scrollToChat();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Processing failed';
      setMessages(prev => [...prev, {
        type: 'error',
        content: `Processing failed: ${errorMessage}`
      }]);
      scrollToChat();
    } finally {
      setProcessing(false);
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
        `${process.env.REACT_APP_API_URL}/youtube/query`,
        { question },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setMessages(prev => [...prev, {
          type: 'bot',
          content: response.data.answer,
          sources: response.data.sources
        }]);
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

  const deleteVideo = async (videoId, title) => {
    if (!window.confirm(`Delete "${title}"?`)) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(
        `${process.env.REACT_APP_API_URL}/youtube/${videoId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setMessages(prev => [...prev, {
        type: 'system',
        content: `Deleted "${title}"`
      }]);
      fetchUserVideos();
    } catch (error) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: 'Delete failed'
      }]);
    }
  };

  const formatText = (text) => {
    if (!text) return '';
    return text.replace(/(\d+\.\s)/g, '\n$1').replace(/\.\s+([A-Z])/g, '.\n\n$1').replace(/\n{3,}/g, '\n\n').trim();
  };

  const renderFormattedText = (text) => {
    const lines = formatText(text).split('\n');
    return lines.map((line, index) => {
      const isNumbered = /^\d+\.\s/.test(line.trim());
      return (
        <React.Fragment key={index}>
          {isNumbered ? (
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

  const truncateText = (text, max = 120) => {
    if (!text || text.length <= max) return text;
    return text.substring(0, max) + '...';
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="youtube-page">
      <div className="notes-chat-container">
        <div className="chat-header">
          <button onClick={onBack} className="back-btn">← Back to Dashboard</button>
          <h2>Ask Questions from YouTube Videos</h2>
        </div>

        <div className="upload-section-compact">
          <div className="tab-selector">
            <button 
              className={`tab-btn ${activeTab === 'url' ? 'active' : ''}`}
              onClick={() => setActiveTab('url')}
            >
              Process by URL
            </button>
            <button 
              className={`tab-btn ${activeTab === 'paste' ? 'active' : ''}`}
              onClick={() => setActiveTab('paste')}
            >
              Paste Transcript
            </button>
          </div>

          {activeTab === 'url' && (
            <form onSubmit={handleUrlProcess} className="compact-form">
              <div className="compact-input-group">
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="YouTube URL or Video ID"
                  disabled={processing}
                  className="compact-input"
                />
                <button 
                  type="submit" 
                  disabled={processing || !videoUrl.trim()}
                  className="compact-btn"
                >
                  {processing ? 'Processing...' : 'Process'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'paste' && (
            <form onSubmit={handlePasteProcess} className="compact-form">
              <textarea
                value={pastedTranscript}
                onChange={(e) => setPastedTranscript(e.target.value)}
                placeholder="Paste transcript here (min 50 chars)..."
                disabled={processing}
                className="compact-textarea"
                rows="4"
              />
              <div className="compact-optional">
                <input
                  type="text"
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value)}
                  placeholder="Title (optional)"
                  disabled={processing}
                  className="compact-input"
                />
              </div>
              <button 
                type="submit" 
                disabled={processing || !pastedTranscript.trim()}
                className="compact-btn"
              >
                {processing ? 'Processing...' : 'Process Transcript'}
              </button>
            </form>
          )}

          {processedVideos.length > 0 && (
            <div className="compact-videos">
              <strong>{processedVideos.length} video(s) processed</strong>
              <details>
                <summary>View all</summary>
                <div className="videos-dropdown">
                  {processedVideos.map((video) => (
                    <div key={video._id} className="compact-video-item">
                      <span className="video-title-compact">{video.title}</span>
                      <button
                        onClick={() => deleteVideo(video._id, video.title)}
                        className="delete-btn-small"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        <div ref={chatSectionRef} className="chat-messages">
          {messages.length === 0 && processedVideos.length === 0 && (
            <div className="welcome-message">
              <p>Process a video using URL or paste transcript, then ask questions below.</p>
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
                            <strong>{source.video_title}</strong>
                            {source.youtube_url && (
                              <a 
                                href={source.youtube_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="timestamp-link"
                              >
                                {source.timestamp}
                              </a>
                            )}
                            <div className="source-preview">
                              {truncateText(source.content_preview, 150)}
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
                  <span>Analyzing</span>
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
            placeholder="Ask a question about your videos..."
            disabled={loading || processedVideos.length === 0}
            className="question-input"
          />
          <button 
            type="submit" 
            disabled={loading || !question.trim() || processedVideos.length === 0}
            className="send-btn"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </form>

        {processedVideos.length === 0 && (
          <div className="no-files-message">
            Process a video first to start asking questions.
          </div>
        )}
      </div>
    </div>
  );
};

export default YouTubeChat;