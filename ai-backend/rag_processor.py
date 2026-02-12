import os
import uuid
from typing import List, Dict
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_community.vectorstores import Chroma
from langchain_groq import ChatGroq
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
import chromadb
from chromadb.config import Settings
import hashlib
import numpy as np

# Simple embeddings without sentence-transformers
class SimpleEmbeddings:
    """Simple word-based embeddings without requiring sentence-transformers"""
    
    def __init__(self, dimension=384):
        self.dimension = dimension
        
    def _text_to_vector(self, text: str) -> List[float]:
        """Convert text to a simple hash-based vector"""
        # Create a deterministic vector from text
        text_hash = hashlib.md5(text.lower().encode()).hexdigest()
        
        # Convert hash to numbers and normalize
        vector = []
        for i in range(0, len(text_hash), 2):
            vector.append(int(text_hash[i:i+2], 16) / 255.0)
        
        # Pad or truncate to desired dimension
        while len(vector) < self.dimension:
            vector.extend(vector)
        
        return vector[:self.dimension]
    
    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed a list of documents"""
        return [self._text_to_vector(text) for text in texts]
    
    def embed_query(self, text: str) -> List[float]:
        """Embed a single query"""
        return self._text_to_vector(text)

class RAGProcessor:
    def __init__(self):
        self.groq_api_key = os.getenv('GROQ_API_KEY')
        if not self.groq_api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
            
        self.chroma_persist_directory = os.getenv('CHROMA_PERSIST_DIRECTORY', './vector_store')
        
        # Initialize simple embeddings (fallback if sentence-transformers fails)
        try:
            from sentence_transformers import SentenceTransformer
            
            class SentenceTransformerEmbeddings:
                def __init__(self, model_name="all-MiniLM-L6-v2"):
                    self.model = SentenceTransformer(model_name)
                
                def embed_documents(self, texts):
                    return self.model.encode(texts).tolist()
                
                def embed_query(self, text):
                    return self.model.encode([text])[0].tolist()
            
            self.embeddings = SentenceTransformerEmbeddings("all-MiniLM-L6-v2")
            print("Using SentenceTransformer embeddings")
            
        except ImportError:
            print("SentenceTransformers not available, using simple embeddings")
            self.embeddings = SimpleEmbeddings()
        except Exception as e:
            print(f"Error loading SentenceTransformers, using simple embeddings: {e}")
            self.embeddings = SimpleEmbeddings()
        
        # Initialize LLM with updated model name
        try:
            # Updated model names for Groq
            # Try different model names in order of preference
            model_options = [
                "llama-3.1-8b-instant",    # New model name
                "llama3-8b-8192",          # Old model (might still work)
                "mixtral-8x7b-32768",      # Alternative model
                "llama-3.1-70b-versatile", # Another option
                "gemma-7b-it"              # Fallback option
            ]
            
            self.llm = None
            for model_name in model_options:
                try:
                    print(f"Trying Groq model: {model_name}")
                    self.llm = ChatGroq(
                        groq_api_key=self.groq_api_key,
                        model_name=model_name,
                        temperature=0.1,
                        max_tokens=1024
                    )
                    # Test the model with a simple query
                    test_response = self.llm.invoke("Hello")
                    print(f"✅ Successfully initialized Groq with model: {model_name}")
                    break
                except Exception as model_error:
                    print(f"❌ Failed to initialize {model_name}: {str(model_error)}")
                    continue
            
            if self.llm is None:
                raise Exception("All Groq models failed to initialize")
                
        except Exception as e:
            print(f"Error initializing Groq LLM: {e}")
            raise e
        
        # Initialize text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
            separators=["\n\n", "\n", " ", ""]
        )
        
        # Custom prompt template
        self.prompt_template = """
        Use the following pieces of context to answer the question at the end. 
        If you don't know the answer based on the provided context, just say "I don't have enough information in the provided notes to answer this question."
        
        Context: {context}
        
        Question: {question}
        
        Answer: """
        
        self.prompt = PromptTemplate(
            template=self.prompt_template,
            input_variables=["context", "question"]
        )
    
    def process_document(self, file_path: str, user_id: str, filename: str) -> Dict:
        """Process and store document in vector database"""
        try:
            print(f"Processing document: {filename} for user: {user_id}")
            
            # Load document based on file type
            if file_path.endswith('.pdf'):
                loader = PyPDFLoader(file_path)
            elif file_path.endswith('.txt'):
                loader = TextLoader(file_path, encoding='utf-8')
            else:
                return {"success": False, "error": "Unsupported file type"}
            
            # Load and split documents
            documents = loader.load()
            if not documents:
                return {"success": False, "error": "Could not extract content from file"}
                
            texts = self.text_splitter.split_documents(documents)
            print(f"Split document into {len(texts)} chunks")
            
            # Add metadata
            for text in texts:
                text.metadata.update({
                    'user_id': user_id,
                    'filename': filename,
                    'doc_id': str(uuid.uuid4())
                })
            
            # Create collection name for user
            collection_name = f"user_{user_id.replace('-', '_')}_notes"
            
            # Initialize Chroma with user-specific collection
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            # Add documents to vector store
            vectorstore.add_documents(texts)
            vectorstore.persist()
            
            print(f"Successfully stored {len(texts)} chunks in vector database")
            
            return {
                "success": True, 
                "message": f"Successfully processed {len(texts)} chunks from {filename}",
                "chunks_count": len(texts)
            }
            
        except Exception as e:
            print(f"Error processing document: {str(e)}")
            return {"success": False, "error": str(e)}
    
    def query_documents(self, user_id: str, question: str) -> Dict:
        """Query user's documents using RAG"""
        try:
            print(f"Querying documents for user: {user_id} with question: {question}")
            
            collection_name = f"user_{user_id.replace('-', '_')}_notes"
            
            # Initialize Chroma with user-specific collection
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            # Check if collection exists and has documents
            try:
                collection = vectorstore._collection
                count = collection.count()
                print(f"Found {count} documents in collection")
                
                if count == 0:
                    return {
                        "success": False,
                        "error": "No notes found. Please upload some notes first."
                    }
            except Exception as e:
                print(f"Error checking collection: {e}")
                return {
                    "success": False,
                    "error": "No notes found. Please upload some notes first."
                }
            
            # Create retrieval QA chain using invoke method instead of deprecated __call__
            qa_chain = RetrievalQA.from_chain_type(
                llm=self.llm,
                chain_type="stuff",
                retriever=vectorstore.as_retriever(
                    search_type="similarity",
                    search_kwargs={"k": 3}
                ),
                chain_type_kwargs={"prompt": self.prompt},
                return_source_documents=True
            )
            
            # Get answer using invoke method
            result = qa_chain.invoke({"query": question})
            
            # Extract source information
            sources = []
            for doc in result['source_documents']:
                sources.append({
                    'filename': doc.metadata.get('filename', 'Unknown'),
                    'content_preview': doc.page_content[:200] + "..."
                })
            
            print(f"Generated answer with {len(sources)} sources")
            
            return {
                "success": True,
                "answer": result['result'],
                "sources": sources,
                "question": question
            }
            
        except Exception as e:
            print(f"Error querying documents: {str(e)}")
            return {"success": False, "error": str(e)}
    
    def get_user_notes_info(self, user_id: str) -> Dict:
        """Get information about user's stored notes"""
        try:
            collection_name = f"user_{user_id.replace('-', '_')}_notes"
            
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            try:
                collection = vectorstore._collection
                count = collection.count()
                
                if count == 0:
                    return {"success": True, "notes_count": 0, "files": []}
                
                # Get unique filenames
                results = collection.get()
                filenames = set()
                for metadata in results['metadatas']:
                    if 'filename' in metadata:
                        filenames.add(metadata['filename'])
                
                return {
                    "success": True,
                    "notes_count": count,
                    "files": list(filenames)
                }
            except:
                return {"success": True, "notes_count": 0, "files": []}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def delete_user_notes(self, user_id: str, filename: str = None) -> Dict:
        """Delete user's notes (all or specific file)"""
        try:
            collection_name = f"user_{user_id.replace('-', '_')}_notes"
            
            vectorstore = Chroma(
                collection_name=collection_name,
                embedding_function=self.embeddings,
                persist_directory=self.chroma_persist_directory
            )
            
            if filename:
                # Delete specific file
                collection = vectorstore._collection
                results = collection.get(where={"filename": filename})
                if results['ids']:
                    collection.delete(ids=results['ids'])
                    return {"success": True, "message": f"Deleted {filename}"}
                else:
                    return {"success": False, "error": "File not found"}
            else:
                # Delete all user notes
                try:
                    collection = vectorstore._collection
                    collection.delete()
                    return {"success": True, "message": "All notes deleted"}
                except:
                    return {"success": True, "message": "No notes to delete"}
                    
        except Exception as e:
            return {"success": False, "error": str(e)}