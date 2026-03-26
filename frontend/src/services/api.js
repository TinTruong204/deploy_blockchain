import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "/api" : "https://deploy-blockchain.onrender.com/api");

const API = axios.create({
  baseURL: API_BASE_URL
});

export default API;