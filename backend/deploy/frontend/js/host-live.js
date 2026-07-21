const params =
  new URLSearchParams(
    window.location.search
  );

const roomId =
  params.get("room");

const socket = io(
  API_BASE_URL.replace(
    "/api",
    ""
  )
);

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    await startHostStream(
      roomId
    );

  }
);

async function endLive() {

  try {

    await api.request(
      `/live/${roomId}/end`,
      {
        method:"POST"
      }
    );

    window.location.href =
      "discover.html";

  } catch(err){

    console.error(err);

  }

}