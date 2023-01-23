const { spawnSync } = require("child_process")
const { readFileSync, createWriteStream, unlinkSync } = require("fs")
const centra = require('centra')
const https = require('https')
const AWS = require("aws-sdk")

const s3 = new AWS.S3()

"use strict"

async function hello(event) {
  console.log("=== EVENT BODY", event.Records[0].body)
  if (event.Records[0].body[0] != "{") return

  let body = JSON.parse(event.Records[0].body)

  const {
    videoId,
    audioUrl,
    imageUrl,
    filterComplex,
    duration,
    frame_rate,
    webhook_base_url
  } = body

  if (!videoId || !audioUrl || !imageUrl || !filterComplex || !duration || !frame_rate || !webhook_base_url) {
    console.log("Required params not found")
    return
  }

  console.log("=== Video ID", videoId)
  console.log("=== Audio URL", audioUrl)
  console.log("=== Image URL", imageUrl)
  console.log("=== Filter Complex", filterComplex)
  console.log("=== Duration", duration)
  console.log("=== Frame Rate", frame_rate)
  console.log("=== Webhook Base URL", webhook_base_url)

  const imagePath = "/tmp/image.jpg"
  const audioPath = "/tmp/audio.mp3"
  const maskPath = "./assets/mask.png"
  const shadowPath = "./assets/shadow.png"

  console.log("=== Start downloading files")
  await downloadFile(imageUrl, imagePath)
  await downloadFile(audioUrl, audioPath)
  console.log("=== Finish downloading files")

  const videoName = "video-" + videoId + ".mp4"
  const videoPath = "/tmp/" + videoName

  // INPUTS
  // [0] IMAGE
  // [1] AUDIO
  // [2] MASK
  // [3] SHADOW

  console.log("=== Start FFMPEG")
  spawnSync(
    "/opt/ffmpeg/ffmpeg",
    [
      "-y",
      "-r", frame_rate,
      "-loop", "1",
      "-i", imagePath,
      "-i", audioPath,
      "-loop", "1",
      "-i", maskPath,
      "-loop", "1",
      "-i", shadowPath,
      "-filter_complex", filterComplex,
      "-t", parseInt(duration) - 0.05,
      videoPath
    ],
    { stdio: "inherit" }
  )
  console.log("=== Finish FFMPEG")

  const tempFile = readFileSync(videoPath)

  console.log("=== Start S3 upload")
  await s3.putObject({
    Bucket: "klippr-temp",
    Key: videoName,
    Body: tempFile
  }).promise()
  console.log("=== Finish S3 upload")

  unlinkSync(imagePath)
  unlinkSync(audioPath)
  unlinkSync(videoPath)

  console.log("=== Sending POST request to update Rails video", videoId);
  const webhook_url = webhook_base_url + "/webhooks/update_video"
  const json = {
    video_id: videoId,
    video_temp_url: "https://klippr-temp.s3.us-east-1.amazonaws.com/" + videoName
  }
  const res = await centra(webhook_url, "POST").body(json, "json").send()
	console.log("=== POST result", await res.statusCode)

  if (res.statusCode == 200) {
    console.log("=== Deleting S3 file")
    await s3.deleteObject({
      Bucket: "klippr-temp",
      Key: videoName
    }).promise()
    console.log("=== Deleted S3 file")
  } else {
    console.log("=== S3 FILE NOT DELETED")
  }

  console.log("=== Done with video " + videoId)
}

async function downloadFile (url, targetFile) {
  return await new Promise((resolve, reject) => {
    https.get(url, response => {
      const code = response.statusCode ?? 0

      if (code >= 400) {
        return reject(new Error(response.statusMessage))
      }

      if (code > 300 && code < 400 && !!response.headers.location) {
        return downloadFile(response.headers.location, targetFile)
      }

      const fileWriter = createWriteStream(targetFile)
      .on('finish', () => {
        resolve({})
      })

      response.pipe(fileWriter)
    }).on('error', error => {
      reject(error)
    })
  })
}

module.exports = {hello}
