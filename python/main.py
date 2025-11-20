import os
import time
import httpx
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

# Load environment variables
load_dotenv(dotenv_path='../.env')

app = FastAPI()

# Configuration
CONFIG = {
    "client_id": os.getenv("OAUTH_CLIENT_ID"),
    "client_secret": os.getenv("OAUTH_CLIENT_SECRET"),
    "token_url": os.getenv("OAUTH_TOKEN_URL"),
    "target_api_base_url": os.getenv("TARGET_API_BASE_URL"),
    "incoming_bearer_token": os.getenv("INCOMING_BEARER_TOKEN"),
}

# Token Cache
token_cache = {
    "access_token": None,
    "expires_at": 0
}

async def get_access_token():
    """Fetches and caches the OAuth2 access token."""
    now = time.time()
    
    # Return cached token if valid (with 10s buffer)
    if token_cache["access_token"] and token_cache["expires_at"] > now + 10:
        return token_cache["access_token"]

    print("Fetching new access token...")
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                CONFIG["token_url"],
                data={
                    "grant_type": "client_credentials",
                    "client_id": CONFIG["client_id"],
                    "client_secret": CONFIG["client_secret"]
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            )
            response.raise_for_status()
            data = response.json()
            
            token_cache["access_token"] = data["access_token"]
            # expires_in is usually in seconds
            expires_in = data.get("expires_in", 3600) # Default to 1 hour if missing
            token_cache["expires_at"] = now + expires_in
            
            print("Token refreshed successfully.")
            return token_cache["access_token"]
            
        except httpx.HTTPStatusError as e:
            print(f"Error fetching access token: {e.response.text}")
            raise HTTPException(status_code=502, detail="Failed to authenticate with upstream API")
        except Exception as e:
            print(f"Error: {str(e)}")
            raise HTTPException(status_code=502, detail="Internal Server Error during auth")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Middleware to check for incoming Bearer token."""
    if CONFIG["incoming_bearer_token"]:
        auth_header = request.headers.get("Authorization")
        if not auth_header or auth_header != f"Bearer {CONFIG['incoming_bearer_token']}":
            return Response(content='{"error": "Unauthorized: Invalid or missing Bearer token"}', status_code=401, media_type="application/json")
    
    return await call_next(request)

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy(request: Request, path: str):
    """Catch-all route to proxy requests."""
    try:
        upstream_token = await get_access_token()
        
        # Safe URL joining
        base_url = CONFIG['target_api_base_url'].rstrip('/')
        target_url = f"{base_url}/{path}"
        
        if request.query_params:
            target_url += f"?{request.query_params}"
            
        print(f"Proxying {request.method} request to: {target_url}")

        # Read the full body
        body = await request.body()

        # Prepare headers
        # We need to be careful not to send duplicate headers (e.g. 'authorization' vs 'Authorization')
        # and to strip hop-by-hop headers.
        hop_by_hop = {
            "connection", "keep-alive", "proxy-authenticate", 
            "proxy-authorization", "te", "trailers", "transfer-encoding", 
            "upgrade", "host", "content-length", "authorization"
        }
        
        filtered_headers = {}
        for key, value in request.headers.items():
            if key.lower() not in hop_by_hop:
                filtered_headers[key] = value

        # Add the correct upstream Authorization header
        filtered_headers["Authorization"] = f"Bearer {upstream_token}"

        client = httpx.AsyncClient()
        req = client.build_request(
            request.method,
            target_url,
            headers=filtered_headers,
            content=body
        )
        
        r = await client.send(req, stream=True)
        
        return StreamingResponse(
            r.aiter_raw(),
            status_code=r.status_code,
            headers=r.headers,
            background=None
        )

    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"Proxy error: {str(e)}")
        return Response(content=f'{{"error": "Bad Gateway", "details": "{str(e)}"}}', status_code=502, media_type="application/json")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
