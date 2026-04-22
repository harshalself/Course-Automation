(function () {
  const video = document.querySelector("video");
  if (!video) {
    return;
  }

  Object.defineProperty(video, "duration", {
    value: 1,
    configurable: true,
  });
  video.dispatchEvent(new Event("loadedmetadata"));
  video.currentTime = 0.9;
  void video.play();
})();
