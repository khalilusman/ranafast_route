CREATE TABLE `learnedMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`routeId` int NOT NULL,
	`stopId` int NOT NULL,
	`originalTranscript` varchar(255) NOT NULL,
	`normalizedTranscript` varchar(255) NOT NULL,
	`firstConfirmedAt` timestamp NOT NULL DEFAULT (now()),
	`lastConfirmedAt` timestamp NOT NULL DEFAULT (now()),
	`confirmationCount` int NOT NULL DEFAULT 1,
	`tags` json,
	CONSTRAINT `learnedMappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `learnedMappings_route_stop_transcript_idx` UNIQUE(`routeId`,`stopId`,`normalizedTranscript`)
);
