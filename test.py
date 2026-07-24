import os

from dotenv import load_dotenv
from supabase import Client, create_client


load_dotenv()

supabase_url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
supabase_service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase_admin: Client = create_client(
    supabase_url,
    supabase_service_role_key,
)

try:
    result = supabase_admin.table("Account").select("*").limit(1).execute()
    print("Connected to Supabase successfully.")
    print("Sample data:", result.data)
except Exception as error:
    print("Connection failed:", error)
