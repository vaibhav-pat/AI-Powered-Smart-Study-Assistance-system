import os
import uuid
import re
from typing import List, Dict, Optional, Tuple
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_groq import ChatGroq
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from langchain.schema import Document
import hashlib

# Import YouTube libraries
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter
    import yt_dlp
    YOUTUBE_AVAILABLE = True
    print("YouTube libraries loaded successfully")
except ImportError as e:
    print(f"YouTube libraries not available: {e}")
    print("Install with: pip install youtube-transcript-api yt-dlp --upgrade")
    YOUTUBE_AVAILABLE = False

# Simple embeddings class
class SimpleEmbeddings:
    def __init__(self, dimension=384):
        self.dimension = dimension
        
    def _text_to_vector(self, text: str) -> List[float]:
        text_hash = hashlib.md5(text.lower().encode()).hexdigest()
        vector = []
        for i in range(0, len(text_hash), 2):
            vector.append(int(text_hash[i:i+2], 16) / 255.0)
        while len(vector) < self.dimension:
            vector.extend(vector)
        return vector[:self.dimension]
    
    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._text_to_vector(text) for text in texts]
    
    def embed_query(self, text: str) -> List[float]:
        return self._text_to_vector(text)


class YouTubeProcessor:
    def __init__(self):
        if not YOUTUBE_AVAILABLE:
            raise ImportError("YouTube libraries not installed")
            
        # Get API key
        self.groq_api_key = os.getenv('GROQ_API_KEY')
        if not self.groq_api_key:
            raise ValueError("GROQ_API_KEY not found")
            
        self.chroma_persist_directory = os.getenv('CHROMA_PERSIST_DIRECTORY', './vector_store')
        
        # Initialize embeddings
        try:
            from sentence_transformers import SentenceTransformer
            
            class STEmbeddings:
                def __init__(self):
                    self.model = SentenceTransformer("all-MiniLM-L6-v2")
                
                def embed_documents(self, texts):
                    return self.model.encode(texts).tolist()
                
                def embed_query(self, text):
                    return self.model.encode([text])[0].tolist()
            
            self.embeddings = STEmbeddings()
            print("Using SentenceTransformer embeddings")
        except:
            self.embeddings = SimpleEmbeddings()
            print("Using simple hash embeddings")
        
        # Initialize LLM
        self.llm = None
        for model in ["llama-3.1-8b-instant", "mixtral-8x7b-32768"]:
            try:
                self.llm = ChatGroq(
                    groq_api_key=self.groq_api_key,
                    model_name=model,
                    temperature=0.1,
                    max_tokens=1024
                )
                self.llm.invoke("test")
                print(f"YouTube processor using: {model}")
                break
            except Exception as e:
                print(f"Failed {model}: {e}")
        
        if not self.llm:
            raise Exception("No Groq models available")
        
        # Text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
            separators=["\n\n", "\n", " ", ""]
        )
        
        # Prompt template
        self.prompt = PromptTemplate(
            template="""Use the video transcript context to answer the question.
If you don't know based on the video, say so.

Context: {context}
Question: {question}
Answer: """,
            input_variables=["context", "question"]
        )
    
    def extract_video_id(self, url_or_id: str) -> Optional[str]:
        """Extract 11-character video ID from URL or return if already ID"""
        url_or_id = url_or_id.strip()
        
        # Check if already video ID
        if re.match(r'^[a-zA-Z0-9_-]{11}$', url_or_id):
            return url_or_id
        
        # Extract from URL patterns
        patterns = [
            r'(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})',
            r'(?:youtu\.be\/)([a-zA-Z0-9_-]{11})',
            r'(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url_or_id)
            if match:
                return match.group(1)
        
        return None
    
    def get_video_metadata(self, video_id: str) -> Dict:
        """Get video info using yt-dlp"""
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'skip_download': True
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                
                return {
                    "title": info.get('title', 'Unknown'),
                    "channel": info.get('uploader', 'Unknown'),
                    "length": info.get('duration', 0),
                    "thumbnail": info.get('thumbnail', f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"),
                    "description": ""
                }
        except Exception as e:
            print(f"Metadata error: {e}")
            return {
                "title": f"Video {video_id}",
                "channel": "Unknown",
                "length": 0,
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
                "description": ""
            }
   
    def get_transcript(self, video_id: str) -> Tuple[Optional[str], Optional[List], str]:
        """Get English transcript from video"""
        try:
            print(f"Getting transcript for: {video_id}")
            
            # Try English variants
            for lang_code in ['en', 'en-US', 'en-GB', 'a.en']:
                try:
                    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                    transcript = transcript_list.find_transcript([lang_code])
                    data = transcript.fetch()
                    
                    formatter = TextFormatter()
                    text = formatter.format_transcript(data)
                    
                    print(f"Found transcript in {lang_code}, length: {len(text)}")
                    return text, data, lang_code
                except:
                    continue
            
            # Try any available transcript
            try:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                available = list(transcript_list)
                if available:
                    transcript = available[0]
                    data = transcript.fetch()
                    formatter = TextFormatter()
                    text = formatter.format_transcript(data)
                    print(f"Using {transcript.language_code}")
                    return text, data, transcript.language_code
            except:
                pass
            
            return None, None, "No transcript"
            
        except Exception as e:
            print(f"Transcript error: {e}")
            return None, None, str(e)
    
    def process_video(self, url_or_id: str, user_id: str, language: str = 'english') -> Dict:
        """Main processing function"""
        try:
            print(f"Processing: {url_or_id} for user: {user_id}")
            
            # Extract video ID
            video_id = self.extract_video_id(url_or_id)
            if not video_id:
                return {"success": False, "error": "Invalid YouTube URL or video ID"}
            
            # Get metadata (optional, doesn't block if fails)
            metadata = self.get_video_metadata(video_id)
            
            # Get transcript (required)
            full_text, transcript_data, lang = self.get_transcript(video_id)
            
            if not full_text:
                return {
                    "success": False, 
                    "error": "No captions available. Try videos from TED, Khan Academy, or other educational channels."
                }
            
            # Build documents with timestamps
            documents = []
            current_text = ""
            current_start = 0
            
            for i, entry in enumerate(transcript_data):
                current_text += entry['text'] + " "
                
                if len(current_text) >= 800 or i == len(transcript_data) - 1:
                    doc = Document(
                        page_content=current_text.strip(),
                        metadata={
                            'video_id': video_id,
                            'start_time': current_start,
                            'end_time': entry['start'] + entry['duration'],
                            'language': lang
                        }
                    )
                    documents.append(doc)
                    current_start = entry['start']
                    current_text = ""
            
            # Split into chunks
            chunks = self.text_splitter.split_documents(documents)
            
            # Add metadata
            for chunk in chunks:
                chunk.metadata.update({
                    'user_id': user_id,
                    'video_id': video_id,
                    'video_title': metadata['title'],
                    'channel': metadata['channel'],
                    'doc_id': str(uuid.uuid4()),
                    'youtube_url': f"https://youtu.be/{video_id}?t={int(chunk.metadata.get('start_time', 0))}"
                })
            
            # Store in ChromaDB
            collection_name = f"user_{user_id.replace('-', '_')}_youtube"
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            vectorstore.add_documents(chunks)
            vectorstore.persist()
            
            print(f"Stored {len(chunks)} chunks")
            
            return {
                "success": True,
                "message": f"Processed '{metadata['title']}' - {len(chunks)} chunks",
                "video_data": {
                    "video_id": video_id,
                    "title": metadata['title'],
                    "channel": metadata['channel'],
                    "thumbnail": metadata['thumbnail'],
                    "length": metadata['length'],
                    "language": lang,
                    "chunks_count": len(chunks)
                }
            }
            
        except Exception as e:
            print(f"Processing error: {e}")
            return {"success": False, "error": str(e)}
    
    def query_videos(self, user_id: str, question: str) -> Dict:
        """Query processed videos"""
        try:
            print(f"Query from {user_id}: {question}")
            
            collection_name = f"user_{user_id.replace('-', '_')}_youtube"
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            # Check if has videos
            try:
                count = vectorstore._collection.count()
                if count == 0:
                    return {"success": False, "error": "No videos processed yet"}
            except:
                return {"success": False, "error": "No videos processed yet"}
            
            # Create QA chain
            qa_chain = RetrievalQA.from_chain_type(
                llm=self.llm,
                chain_type="stuff",
                retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
                chain_type_kwargs={"prompt": self.prompt},
                return_source_documents=True
            )
            
            # Get answer
            result = qa_chain.invoke({"query": question})
            
            # Format sources
            sources = []
            for doc in result['source_documents']:
                start = int(doc.metadata.get('start_time', 0))
                sources.append({
                    'video_title': doc.metadata.get('video_title', 'Unknown'),
                    'channel': doc.metadata.get('channel', 'Unknown'),
                    'youtube_url': doc.metadata.get('youtube_url', ''),
                    'timestamp': f"{start//60}:{start%60:02d}",
                    'content_preview': doc.page_content[:200] + "..."
                })
            
            return {
                "success": True,
                "answer": result['result'],
                "sources": sources,
                "question": question
            }
            
        except Exception as e:
            print(f"Query error: {e}")
            return {"success": False, "error": str(e)}
    
    def get_user_videos_info(self, user_id: str) -> Dict:
        """Get user's video list"""
        try:
            collection_name = f"user_{user_id.replace('-', '_')}_youtube"
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            try:
                count = vectorstore._collection.count()
                if count == 0:
                    return {"success": True, "videos_count": 0, "videos": []}
                
                results = vectorstore._collection.get()
                videos = {}
                for meta in results['metadatas']:
                    vid = meta.get('video_id')
                    if vid and vid not in videos:
                        videos[vid] = {
                            'video_id': vid,
                            'title': meta.get('video_title', 'Unknown'),
                            'channel': meta.get('channel', 'Unknown'),
                            'youtube_url': f"https://youtu.be/{vid}"
                        }
                
                return {
                    "success": True,
                    "videos_count": count,
                    "videos": list(videos.values())
                }
            except:
                return {"success": True, "videos_count": 0, "videos": []}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    

    def delete_video(self, user_id: str, video_id: str) -> Dict:
        """Delete a video"""
        try:
            collection_name = f"user_{user_id.replace('-', '_')}_youtube"
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            results = vectorstore._collection.get(where={"video_id": video_id})
            if results['ids']:
                vectorstore._collection.delete(ids=results['ids'])
                return {"success": True, "message": f"Deleted {video_id}"}
            return {"success": False, "error": "Video not found"}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    def process_pasted_transcript(self, transcript_text: str, user_id: str, video_title: str = "Pasted Video", video_url: str = "") -> Dict:
        """Process manually pasted video transcript"""
        try:
            print(f"Processing pasted transcript for user: {user_id}")
            
            if not transcript_text or len(transcript_text.strip()) < 50:
                return {"success": False, "error": "Transcript text is too short. Please paste a valid transcript."}
            
            # Generate a unique ID for this pasted transcript
            import time
            video_id = f"pasted_{int(time.time())}"
            
            # Clean and prepare text
            cleaned_text = transcript_text.strip()
            
            # Create document
            doc = Document(
                page_content=cleaned_text,
                metadata={
                    'video_id': video_id,
                    'start_time': 0,
                    'end_time': 0,
                    'language': 'unknown',
                    'source': 'pasted_transcript'
                }
            )
            
            # Split into chunks
            chunks = self.text_splitter.split_documents([doc])
            
            # Add metadata to chunks
            for i, chunk in enumerate(chunks):
                chunk.metadata.update({
                    'user_id': user_id,
                    'video_id': video_id,
                    'video_title': video_title or "Pasted Video Transcript",
                    'channel': "Manual Upload",
                    'doc_id': str(uuid.uuid4()),
                    'youtube_url': video_url or "",
                    'chunk_index': i
                })
            
            # Store in ChromaDB
            collection_name = f"user_{user_id.replace('-', '_')}_youtube"
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            vectorstore.add_documents(chunks)
            vectorstore.persist()
            
            print(f"Stored {len(chunks)} chunks from pasted transcript")
            
            return {
                "success": True,
                "message": f"Successfully processed pasted transcript - {len(chunks)} chunks created",
                "video_data": {
                    "video_id": video_id,
                    "title": video_title or "Pasted Video Transcript",
                    "channel": "Manual Upload",
                    "thumbnail": "https://via.placeholder.com/320x180?text=Pasted+Transcript",
                    "length": 0,
                    "language": "unknown",
                    "chunks_count": len(chunks)
                }
            }
            
        except Exception as e:
            print(f"Error processing pasted transcript: {e}")
            return {"success": False, "error": str(e)}