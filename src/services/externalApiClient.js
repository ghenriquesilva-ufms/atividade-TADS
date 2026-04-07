import axios from "axios";

export class ExternalApiClient {
  constructor({ baseUrl, timeoutMs, clientId, clientIdParamName }) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs
    });

    this.clientId = clientId;
    this.clientIdParamName = clientIdParamName;
  }

  async fetchScore(query) {
    const params = {
      ...query,
      [this.clientIdParamName]: this.clientId
    };

    const response = await this.client.get("/score", { params });
    return response.data;
  }
}
