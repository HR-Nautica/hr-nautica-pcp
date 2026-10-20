import { createProxyApp } from "./proxy.js";

// This serverless entry point deliberately contains no business routes. All
// authentication, authorization, CSRF and persistence stay in the Ubuntu API.
export default createProxyApp();
