// AC-08 latency budget. Run against staging with upstreams stubbed at measured p50s.
//   k6 run -e BASE_URL=https://staging.greenchit.bistec -e TOKEN=$TOKEN tests/load/categoriser.k6.js
import http from "k6/http";
import { check } from "k6";
import { FormData } from "https://jslib.k6.io/formdata/0.0.2/index.js";

export const options = {
  scenarios: { claimants: { executor: "constant-vus", vus: 50, duration: "5m" } },
  thresholds: {
    "http_req_duration{expected_response:true}": ["p(95)<4000"], // spec.md §3.5
    http_req_failed: ["rate<0.01"],
  },
};

const receipt = open("../fixtures/meal-receipt.png", "b");

export default function () {
  const fd = new FormData();
  fd.append("receipt", http.file(receipt, "meal-receipt.png", "image/png"));

  const res = http.post(`${__ENV.BASE_URL}/claims/C-1001/receipts/categorise`, fd.body(), {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${fd.boundary}`,
      Authorization: `Bearer ${__ENV.TOKEN}`,
    },
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "under the 8s hard ceiling": (r) => r.timings.duration < 8000,
  });
}
