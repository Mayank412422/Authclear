import axios from "axios";

const apiBaseUrl =
  import.meta.env.VITE_API_URL || "https://authclear.onrender.com";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60000
});

export async function processClaim(file) {
  const formData = new FormData();
  formData.append("claimImage", file);

  const response = await api.post("/api/process-claim", formData, {
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });

  return response.data;
}
