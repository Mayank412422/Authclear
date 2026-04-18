import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5000",
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
